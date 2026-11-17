# Data Model: No Inert Settings Guard (071)

These entities exist only inside the test tooling. Nothing is persisted and no runtime type changes.

## KeyPath

A dot-separated path into `AppSettings`, such as `explorer.dragCopyModifier`. A segment may be `*`, standing for
any key of an index-signature map (research R4).

- **Validation**: a key path is *known* only if it exists in the settings tree, which is built from the
  `AppSettings` type by walking its properties and index signatures.
- **Matching**: a read path matches a descriptor key when it has at least as many segments, and each of the key's
  segments equals the read path's segment at that position or that segment is `*`.

## SettingsTree

Built once per program from the `AppSettings` type.

| Field | Meaning |
|---|---|
| `known` | every `KeyPath` in the tree, `''` (the root) included |
| `pathsOfType` | each object type in the tree → the `KeyPath`s at which it occurs (one type can occur at several, for example `PaneState`) |

## Read

| Field | Meaning |
|---|---|
| `path` | the `KeyPath` read |
| `file` | the repository-relative production file it occurs in |

A property access, element access or object-destructuring element whose result path is known, outside the
configuration layer, and not the target of an assignment (research R3).

## ParameterBinding

A parameter, or a destructured prop of one, → the set of `KeyPath`s that call sites and JSX attributes pass to it.
It is built to a fixpoint before reads are collected (research R3, rule 4).

## ReaderReport

The guard's output, one entry per Settings descriptor.

| Field | Meaning |
|---|---|
| `key` | the descriptor's key |
| `readers` | sorted repository-relative files that read it (FR-013) |

A descriptor with an empty `readers` list that is not on the allowlist is a **finding** (FR-010).

## AllowlistEntry

| Field | Rule |
|---|---|
| `key` | MUST be a current Settings descriptor key (FR-011) |
| `reason` | MUST be non-empty, and MUST NOT be a placeholder (`TODO`, `TBD`, `-`, `n/a`, or under 20 characters) |

**State rule**: an entry whose key now has a reader is **stale**, and staleness fails the build (FR-011). An entry
leaves the list in the same change that gives its setting a reader.

## ConfigurationLayer

An ordered list of repository-relative path prefixes (research R5). A file matching any prefix is never a reader.
The list lives in one module (FR-007).
