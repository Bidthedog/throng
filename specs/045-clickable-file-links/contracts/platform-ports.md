# Contract: the two new platform ports

**Feature**: 045 | **Requirements**: FR-012, FR-025, FR-026, FR-035, FR-036, FR-038, FR-039a

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
}
```

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
spec `IDeElevator.wrap` can carry, instead of Electron's `shell.*` (research R7):

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
