# Contract: settings readers scan (071)

The guard's two modules and the test that drives them. They are test tooling under `packages/core/tests/unit/`,
not production code, and nothing outside the guard and its fixture test imports them.

## `settings-readers-scan.ts`

```ts
/** Build one program over every package's src, with @throng/* mapped to source (research R2). */
export function buildRepoProgram(repoRoot: string): ts.Program;

export interface ScanInput {
  program: ts.Program;
  /** Locates the settings root type; the repo passes the AppSettings interface from core's app-settings.ts. */
  rootType: (checker: ts.TypeChecker, program: ts.Program) => ts.Type;
  /** Descriptor keys to report on (the repo passes SETTINGS_METADATA's keys). */
  keys: readonly string[];
  /** Repository-relative path of a source file. */
  relPath: (sourceFile: ts.SourceFile) => string;
  /** True for a production file that may hold readers; false for tests and declaration files. */
  isProduction: (relPath: string) => boolean;
  /** Path prefixes whose files are never readers (research R5). */
  configLayer: readonly string[];
}

/** One entry per key, in input order, with its sorted reading files. */
export function scanSettingReaders(input: ScanInput): { key: string; readers: string[] }[];
```

**Guarantees**

- Deterministic: the same program and input give the same report, files sorted.
- Pure: no file system writes, no network. Reading source files through the program is the only I/O.
- Never decides readership from source text (FR-009). Names come only from the AST and the checker.

## `inert-settings-policy.ts`

```ts
/** FR-007: the configuration layer, one place. Each entry carries the reason it is excluded. */
export const CONFIGURATION_LAYER: readonly { prefix: string; why: string }[];

/** FR-011: settings meant to be read only by the configuration layer. Ships empty (research R6). */
export const INERT_ALLOWLIST: readonly { key: string; reason: string }[];

/** FR-011's validation of the allowlist against a report; returns the problems, empty when clean. */
export function allowlistProblems(
  allowlist: readonly { key: string; reason: string }[],
  report: readonly { key: string; readers: readonly string[] }[],
): string[];
```

## `no-inert-settings.test.ts` (the guard)

| Case | Asserts | FR |
|---|---|---|
| every descriptor has a reader | findings (unread, not allowlisted) is empty. The failure names **every** finding with "nothing outside the configuration layer reads it" | FR-001, FR-002, FR-010 |
| the allowlist is valid | `allowlistProblems` is empty: every entry has a reason, is current, and is still unread | FR-011 |
| the aliased-read set resolves | `explorer.dragCopyModifier` and the other keys read only through an alias have a reader outside the configuration layer | SC-002 |
| report | with `SETTINGS_READERS_REPORT=1`, prints every key and its readers | FR-013 |

**Failure message shape** (FR-010):

```
3 settings are rendered in Preferences but nothing outside the configuration layer reads them,
so changing them does nothing:
  - editor.example        (no reader)
  - explorer.otherThing   (no reader)
  - tabs.thirdThing       (no reader)
Wire each one to the behaviour it names, remove it with a supersession, or allowlist it with a reason
(packages/core/tests/unit/inert-settings-policy.ts).
```

## `settings-readers-scan.test.ts` (fixtures)

An in-memory program (a `ts.CompilerHost` over virtual files) with a small settings interface, so every rule is
proved in isolation and quickly. One case per rule:

| Fixture | Expected |
|---|---|
| alias `const s = root.a; s.b` | `a.b` read |
| destructure `const { b } = root.a` | `a.b` read |
| section passed to a function with a *mirror* parameter type | the function's reads count |
| section passed as a JSX prop, destructured in the component | the component's reads count |
| `Pick<>` parameter | its reads count |
| computed key with a literal union `root.n[sev].t` | each union member's `t` read, and no other |
| `Record<string, P>` map read by `string` key | the `*` path matches every concrete descriptor beneath it |
| two keys of one shared shape, one read by its path | only that one read (FR-006) |
| a key mentioned only in a configuration-layer file | unread |
| a key read only in a test file | unread (FR-008) |
| an assignment `root.a.b = 1` | not a read |
| a primitive of the same type as a setting | never a read (research R3, rule 5) |
| a new key with no reader, and removing the only reader of an existing key | reported unread (SC-003) |
