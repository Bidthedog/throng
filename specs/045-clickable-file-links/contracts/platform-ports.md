# Contract: the two new platform ports

**Feature**: 045 | **Requirements**: FR-012, FR-025, FR-026, FR-035, FR-036, FR-038, FR-039a;
*amended 2026-09-18* — see §5 (no port changes shape); *third round* — see §6 (`IPathForms` gains
four members, the WSL-flavour answer is placed, and FR-038's wiring is stated as the composition
root's obligation, D4).

Principle II. `packages/core` states the rules; `packages/platform-windows` answers the OS
questions; a contract suite in `core/src/testing/` verifies any implementation. Style:
the **pure-throw** form of `core/src/testing/platform-info-contract.ts:18` — the suite imports
nothing and throws `<Port> contract violation: …`, so core stays free of a test-runner dependency
and any layer can run it.

---

## §1 `IPathForms` — `core/src/abstractions/path-forms.ts`

```ts
export interface IPathForms {
  /** The user's home folder, absolute. FR-025's `~`. */
  homeDirectory(): string;

  /** '/d/x' -> 'D:\x'; '/mnt/d/x' -> 'D:\x'. Not a drive form -> null. FR-025. */
  fromDriveForm(posixPath: string): string | null;

  /**
   * A `file:` URI -> an absolute path. FR-012.
   *  - percent-decoded
   *  - a host ('file://server/share/x') -> the UNC location
   *  - no host or 'localhost' -> a local path
   * Not a `file:` URI, or not convertible -> null.
   */
  fromFileUrl(url: string): string | null;

  /** '~' or '~/x' -> the home-relative absolute path. Otherwise null. FR-025. */
  fromHomeForm(path: string): string | null;
}
```

### Contract cases — `core/src/testing/path-forms-contract.ts`

`export function runPathFormsContract(makeSubject: () => IPathForms): void`

| # | Case | FR |
|---|---|---|
| PF1 | `homeDirectory()` is absolute and non-empty | FR-025 |
| PF2 | `fromDriveForm('/d/git/x.ts')` is an absolute path naming drive `d` and ending in `git`+sep+`x.ts` | FR-025 |
| PF3 | `fromDriveForm('/mnt/d/git/x.ts')` equals PF2's answer | FR-025 |
| PF4 | `fromDriveForm('/etc/hosts')`, `fromDriveForm('x')`, `fromDriveForm('')` are all `null` | FR-025 |
| PF5 | `fromDriveForm` is case-insensitive on the letter (`/D/x` = `/d/x`) | FR-025 |
| PF6 | `fromFileUrl('file:///D:/a%20b/c.txt')` decodes to a path containing `a b` | FR-012 |
| PF7 | `fromFileUrl('file://server/share/x.txt')` is the UNC location for host `server`, share `share` | FR-012 |
| PF8 | `fromFileUrl('file://localhost/D:/x')` equals `fromFileUrl('file:///D:/x')` | FR-012 |
| PF9 | `fromFileUrl('http://x/y')`, `'javascript:0'`, `''` are all `null` | FR-013 |
| PF10 | `fromHomeForm('~')` equals `homeDirectory()`; `fromHomeForm('~/x')` is under it | FR-025 |
| PF11 | `fromHomeForm('~user/x')` is `null` — throng does not resolve another user's home | FR-025 |
| PF12 | Every method is **total**: no throw for any string, including one with a NUL, a very long one, and one with mixed separators | — |

The suite asserts *shape and relationship*, never a literal Windows path, so a future macOS or Linux
implementation passes it without the suite being rewritten (Principle II).

---

## §2 `IExecutableExtensions` — `core/src/abstractions/executable-extensions.ts`

```ts
export interface IExecutableExtensions {
  /**
   * Would the operating system EXECUTE this file if it were opened? FR-039a.
   * Answered from the file's EXTENSION alone — never from its contents, and never from a
   * permission bit. The answer is read at the time of the call, so a change the user makes
   * to the OS's own list takes effect without a restart.
   */
  isExecutable(path: string): boolean;

  /**
   * Every extension this implementation currently considers executable, each including its leading
   * dot. Read at the time of the call, for the same reason `isExecutable` is. FR-039a, SC-010.
   */
  executableExtensions(): readonly string[];
}
```

**Two members, reconciled 2026-09-18 (T130)**: the draft's block named only `isExecutable`, while
EX6 below already required the set to be reported. `executableExtensions` is what makes SC-010 a
test rather than a hand-copied list — see EX6.

### The rule the Windows implementation states (and core does not)

`platform-windows/src/windows-executable-extensions.ts`:

1. **The OS's own list** — the entries of the `PATHEXT` environment variable, **read per call**,
   uppercased, compared without case. Its shipped value covers
   `.COM .EXE .BAT .CMD .VBS .VBE .JS .JSE .WSF .WSH .MSC`.
2. **Plus a declared handler-launched set** the OS runs through a handler rather than through
   `PATHEXT`: at minimum `.lnk .url .msi .msp .ps1 .scr .cpl .reg .hta .pif`.

### Contract cases — `core/src/testing/executable-extensions-contract.ts`

`export function runExecutableExtensionsContract(makeSubject: () => IExecutableExtensions): void`

| # | Case | FR |
|---|---|---|
| EX1 | A path with **no** extension is not executable | FR-039a |
| EX2 | A path ending in a separator (a folder form) is not executable — *"a folder is never executable"* | FR-039a |
| EX3 | Extension matching ignores case (`SETUP.EXE` = `setup.exe`) | FR-039a |
| EX4 | Every extension the implementation reports executable is reported executable again on a second call — the answer is stable within one environment | FR-039a |
| EX5 | An ordinary document extension (`.txt`, `.md`, `.ts`, `.json`) is not executable | FR-039a |
| EX6 | The implementation exposes the set it considers executable, and it is non-empty | SC-010 |
| EX7 | `isExecutable` is total: no throw for `''`, a bare `.`, a trailing dot, or a path that is only an extension | — |

EX6 is what lets SC-010 be stated as a test rather than as a list: the unit case for FR-039
iterates the implementation's own reported set and asserts that **none** of them runs under
Ctrl+click, the chord or the plain Open Link item, and that **each** of them runs under the explicit
Open in OS Default Program item.

**Windows-specific cases** (not in the shared suite —
`platform-windows/tests/contract/windows-executable-extensions.contract.test.ts`): `.exe`, `.bat`,
`.cmd`, `.ps1`, `.lnk`, `.msi` are executable; `PATHEXT` is honoured when a fake environment adds an
extension to it, and stops being honoured when the fake removes one (FR-039a's "without a restart").

---

## §3 `IShellIntegration` gains one method, and both OS actions gain de-elevation

**Requirements**: FR-035, FR-036, FR-038.

```ts
export interface IShellIntegration {
  revealInFileManager(path: string): Promise<void>;      // existing
  openFolder(path: string): Promise<void>;               // existing
  openExternal(url: string): Promise<void>;              // existing (044)
  /** FR-036. Open a FILE in the application the OS associates with it. */
  openWithDefaultProgram(path: string): Promise<void>;   // NEW
}
```

### De-elevation (FR-038)

When `shouldDeElevate(...)` (`core/src/terminal/elevation.ts`) says the host is elevated and the
action was not asked to be, `revealInFileManager` and `openWithDefaultProgram` launch through a
de-elevating launcher instead of Electron's `shell.*` (research R7):

> **Amendment 2026-09-18 — the seam is `WindowsDeElevatedLauncher.launch`, not `IDeElevator.wrap`.**
>
> This section originally said both actions "launch through `IDeElevator.wrap({file, args})`".
> Settling Open item O2 showed that cannot work, for two independent reasons.
>
> **`wrap` is the wrong shape.** It *rewrites a spec that something else then spawns* — `NodePtyHost`
> spawns the wrapped spec through node-pty (`node-pty-host.ts:99`). A reveal has no spawner on the
> other side, so a wrapped spec would be built and then dropped.
>
> **And there is no `IDeElevator` to ask.** The repository contains exactly one value of that type,
> `passthroughDeElevator`, whose `isAvailable()` is `false` by construction; nothing binds another,
> in any process. Taking the original text literally would have made FR-038 permanently inert while
> appearing to be implemented — the worst available outcome for a rule about not launching
> administrator programs.
>
> The mechanism that actually de-elevates is `WindowsDeElevatedLauncher.launch(file, args, report)`
> (`platform-windows/src/windows-de-elevated-launcher.ts`), which performs the shell-token
> `CreateProcessWithTokenW` handoff. Its availability is `process.platform === 'win32'` — a property
> of the platform rather than of being the daemon — so **UI main can do this itself**, and FR-038
> needs no new RPC. The launch specs in the table below are unchanged; only what carries them is.

| Action | Launch spec |
|---|---|
| Reveal a file | `{ file: 'explorer.exe', args: ['/select,<path>'] }` |
| Reveal (open) a folder | `{ file: 'explorer.exe', args: ['<path>'] }` |
| Open with default program | `{ file: 'rundll32.exe', args: ['shell32.dll,ShellExec_RunDLL', '<path>'] }` |

Non-elevated, the shipped `shell.showItemInFolder` / `shell.openPath` path is kept **verbatim**, so
the overwhelming majority of runs are byte-for-byte unchanged.

### Contract additions — `core/src/testing/shell-integration-contract.ts`

| # | Case | FR |
|---|---|---|
| SI1 | `openWithDefaultProgram` rejects for a path that does not exist | FR-036 |
| SI2 | `openWithDefaultProgram` rejects for a **folder** — it is a file operation (FR-030) | FR-030, FR-036 |
| SI3 | A rejection carries the path and a reason, so one notice can name both | FR-036, 030 |
| SI4 | In a de-elevating implementation, **neither** OS action is performed by the elevated process itself | FR-038 |

SI4's real verification is an `@admin` case — it is meaningless in a non-elevated run and must not
assert a hollow baseline there (Principle V). Hosted runners are always elevated, so CI can answer
it; see [../quickstart.md](../quickstart.md) §4.

*Note 2026-09-18 (third round) — D4.* SI4 proves the **route** and nothing about the **wiring**: the
`@admin` case constructs `ElectronShellIntegration` with its own launcher, while the app's only
construction (`ui/src/main/main.ts:934`) passes none, so the shipped app never de-elevates. §6.3 makes
supplying the launcher the composition root's stated obligation, and SI5 (a wiring case) is added.

---

## §4 Dependency injection

Both ports are bound in the **UI main** composition root
(`ui/src/main/composition-root.ts`), on the `#199` pattern:

```ts
// ui/src/main/tokens.ts
PathForms: Symbol.for('throng:IPathForms'),
ExecutableExtensions: Symbol.for('throng:IExecutableExtensions'),
FileSystem: Symbol.for('throng:IFileSystem'),        // also bound here — see plan Complexity Tracking

// ui/src/main/composition-root.ts
container.bind<IPathForms>(UI_TYPES.PathForms).toConstantValue(new WindowsPathForms());
container.bind<IExecutableExtensions>(UI_TYPES.ExecutableExtensions)
  .toConstantValue(new WindowsExecutableExtensions());
```

The **daemon** container is untouched: nothing in this feature crosses the daemon boundary.
`FileLinkResolver` receives all four collaborators by constructor
([../data-model.md](../data-model.md) §6).

---

## §5 Amendment 2026-09-18 — what the change request does to these ports

**No port gains or loses a member.** Specifically:

- **`IPathForms`** is unchanged. D1's fix (a UNC base keeping its root) lives in core's `join`, which
  already recognises the UNC shape without naming an OS ([link-resolution.md](./link-resolution.md)
  §6.2). The volume root that FR-121 gates on is derived in **UI main** with `node:path`, which is
  where an OS path module is allowed; no core rule needs it. A mapped-drive/UNC alias is judged by
  name (FR-106), so no "canonical location" member is added — that would be `realpath`, which the
  symlink rule (M5) deliberately avoids.
- **`IExecutableExtensions`** is unchanged in shape and keeps its contract suite, but **loses its only
  production consumer**: the click rule (FR-110) no longer branches on executability, because it
  never reaches the default program for any file (FR-111, FR-114). It stays because FR-039a stays in
  force and SC-010/SC-013 are driven from its reported set (EX6). Recorded as a Principle VIII
  tension in [../plan.md](../plan.md) Complexity Tracking and reported to the maintainer for a
  keep-or-retire decision. `ResolvedLink.executable` is kept for the same reason and the same review.
- **`IShellIntegration.openWithDefaultProgram`** is unchanged, and after FR-111 its only caller is the
  named *Open in OS Default Program* item.

---

## §6 Amendment 2026-09-18, third round — what the corpus probe does to these ports

§5's "no port gains or loses a member" held for the change request. It does not hold for the third
round: FR-151 – FR-153 each need an OS fact that only the platform can answer, and FR-026 forbids core
from answering it.

### §6.1 `IPathForms` gains four members (FR-151, FR-152, FR-153)

```ts
export interface IPathForms {
  // … the four members of §1, unchanged …

  /**
   * FR-151. A rooted POSIX path mapped through Git Bash's own mount table — the Git for Windows
   * install root for `/`, plus the mount points Git declares (its `etc/fstab` and its built-in
   * defaults: `/usr/bin` and `/bin`, `/tmp` as the user's temp folder, …). `null` when Git for
   * Windows is not installed, when the input is not rooted, and for a drive form (`/c/x`,
   * `/mnt/c/x` are `fromDriveForm`'s).
   */
  fromMountTable(posixPath: string): string | null;

  /**
   * FR-152. A rooted path with no drive (`\tmp`, `/tmp`), qualified with the drive of `anchor` —
   * an absolute path the caller already holds (a base directory or a project root). `null` when
   * `anchor` is not absolute or has no drive to lend (a UNC anchor lends its `\\server\share`).
   */
  qualifyRooted(rootedPath: string, anchor: string): string | null;

  /**
   * FR-153. For a `file:` URI with no host or host `localhost`, the decoded path when it is NOT
   * drive-qualified (`file:///c/Windows/win.ini` → `/c/Windows/win.ini`), so core can resolve it as
   * the same path written bare. `null` for a drive-qualified path (R8 handles it), a hosted URI, and
   * anything not a `file:` URI.
   */
  fileUrlLocalPath(url: string): string | null;

  /**
   * FR-153. For a `localhost` URI whose first segment is not a drive
   * (`file://localhost/C$/Windows/win.ini`), the loopback network location
   * (`\\localhost\C$\Windows\win.ini`). `null` otherwise, including for a hostless URI.
   */
  loopbackFromFileUrl(url: string): string | null;
}
```

**Where Git's install root comes from.** The shell detection that already finds Git Bash
(`platform-windows/src/windows-shell-detection.ts`, 005 FR-024) knows the install; `WindowsPathForms`
takes it by constructor and reads the mount table **once**, lazily, and caches it. No new
dependency on the detection's own callers.

| # | Case (added to `core/src/testing/path-forms-contract.ts`) | FR |
|---|---|---|
| PF13 | Over a subject given a Git root: `fromMountTable('/usr/bin/bash.exe')` is under that root and ends in `bash.exe`; `fromMountTable('/etc/hosts')` is under it and ends in `hosts` | FR-151 |
| PF14 | `fromMountTable('/tmp')` is absolute and is **not** under the Git root when the mount table maps `/tmp` elsewhere (Git's shipped `usertemp` mapping) | FR-151 |
| PF15 | `fromMountTable('/c/x')`, `('/mnt/c/x')`, `('x')`, `('')` are `null`; a subject given **no** Git root answers `null` for every input | FR-151, FR-025 |
| PF16 | `qualifyRooted('/tmp', A)` and `qualifyRooted('\\tmp', A)` are absolute, on `A`'s drive; with a non-absolute `A`, `null` | FR-152 |
| PF17 | `fileUrlLocalPath('file:///c/Windows/win.ini')` = `'/c/Windows/win.ini'`; `('file://localhost/mnt/c/x')` = `'/mnt/c/x'`; `('file:///D:/x')`, `('file://server/share/x')` are `null` | FR-153 |
| PF18 | `loopbackFromFileUrl('file://localhost/C$/Windows/win.ini')` names host `localhost`, share `C$` and ends in `win.ini`; `('file://localhost/D:/x')`, `('file:///C$/x')` are `null` | FR-153 |
| PF19 | PF8 still holds (`file://localhost/D:/x` = `file:///D:/x`), and PF7's hosted case is unchanged | FR-012 |
| PF12′ | *Extends PF12.* The four new members are total: `null`, never a throw, for any string | — |

(PF13 was named once in §2's amendment of [link-resolution.md](./link-resolution.md) as the case a
rejected separator-normalising member *would* have needed. That member was never added; the number is
used here for the first time.)

### §6.2 "Is this flavour WSL?" — placed, not yet shaped (FR-144, FR-151)

Two requirements now read this answer: FR-144 (a WSL flavour's link base is absent) and FR-151 (a WSL
flavour skips Git's mount table). It is an OS fact — WSL is recognised by its `System32\wsl.exe` /
`System32\bash.exe` executable, which the shell detection already tells apart from Git Bash — so it
sits behind the platform abstraction, beside that detection. Its exact name and home are T189's to
settle; this contract fixes only that **one** answer serves both requirements, so they cannot
disagree about which terminals are WSL.

*Settled by T189 (2026-09-18):* `isWslExecutable(file)` in `packages/core/src/terminal/wsl-flavour.ts`,
beside `flavourReportsDirectory`, not a port. The question is asked by the **renderer**, at hover
time, about a user-defined flavour it already holds in settings; the renderer has no route to
`platform-windows` and no synchronous bridge, and the answer is a pure reading of an executable path
(`wsl[.exe]` anywhere; `bash[.exe]` directly in `System32`/`Sysnative`). Only a user-defined flavour
can be WSL — the built-in detection skips `System32\bash.exe`. Cases:
`packages/core/tests/unit/wsl-flavour.test.ts`. The terminal panel feeds it to
`terminalLinkBaseDirectory` (FR-144) and to the request's `wslFlavour` (FR-151).

### §6.3 FR-038's launcher is the composition root's obligation (D4)

§3 said a de-elevating launcher is used "when `shouldDeElevate(...)` says the host is elevated". It
did not say who supplies it, and nothing did. Stated now:

- **UI main's composition** MUST construct `ElectronShellIntegration` with `DeElevationOptions`
  carrying a `WindowsDeElevatedLauncher` and an elevation probe (`WindowsElevation().isElevated()`,
  already used for the daemon at `main.ts:704`). A construction without them is the defect D4.
- Research O2 already established the launcher is available in UI main, so this needs no RPC.

| # | Case | FR |
|---|---|---|
| SI5 | The **app's** shell integration — as the composition builds it, not as a test builds it — routes `revealInFileManager`, `openFolder` and `openWithDefaultProgram` through the launcher when the probe answers elevated. A unit case over the extracted factory (T217) | FR-038, D4 |

---

## §7 Amendment 2026-09-19, round four

### §7.1 `IRefusedUriSchemes` — `core/src/abstractions/refused-uri-schemes.ts` (FR-159)

```ts
export interface IRefusedUriSchemes {
  /** Lower-case scheme names, no colon, this platform refuses to hand to any handler. */
  refusedSchemes(): ReadonlySet<string>;
}
```

Windows: `platform-windows/src/windows-refused-uri-schemes.ts` (research R27). Contract suite
`core/src/testing/refused-uri-schemes-contract.ts`: non-empty; lower-case; no colon; disjoint from
`http`/`https`; stable across calls. Windows-specific cases in the implementation's own test
(`ms-msdt`, `search-ms` present). Bound in UI main's composition root; consumed by the
`throng:linkUri:openExternal` handler.

### §7.2 `IShellIntegration` reports the OS's reason (T229, FR-036)

`revealInFileManager` and `openWithDefaultProgram` resolve `{ ok: true } | { ok: false; reason: string }`.
Contract addition: a failing fake yields `ok: false` with a non-empty `reason`.

### §7.3 `IExecutableExtensions` regains a production consumer

Open Program (FR-170) is offered only when the resolved file is executable by this port — §5's
"test oracle only" note is superseded.

*§7.2 amended 2026-09-19 (after analysis): the failure is `{ ok: false; osReason: string }` — `reason` is already `LinkActionOutcome`'s discriminant (data-model §16.10).*

*§7.1 amended 2026-09-19 (fourth analysis pass): `IRefusedUriSchemes` has two consumers in UI main —
the `throng:linkUri:openExternal` handler and the `throng:linkUri:refusedSchemes` handler the renderer asks
once at startup (research R34).*

*§7.1 amended 2026-09-19 (tenth analysis pass): the Windows contract test pins every entry of research R27's list — `ms-msdt`, `search-ms`, `search`, `ms-officecmd`, `ms-appinstaller`, `ms-cxh`, `ms-cxh-full` — not only the first two.*
