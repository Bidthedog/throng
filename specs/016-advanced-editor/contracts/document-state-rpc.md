# Contract — `document.*` daemon RPC

**Requirement**: FR-028b / FR-028e · **Transport**: JSON-RPC 2.0, newline-delimited, over the Windows
named pipe (`\\.\pipe\throng.daemon`).

Persists the **document-scoped manual language override** so that a panel opening the file **later** —
in another session, another window, or a sub-workspace — **adopts** it rather than re-detecting.

The store lives behind the daemon, so this needs **new RPC**. Adding a method requires a contract file, a
daemon service registration, and a renderer client — and **no change** to `throng:rpc`, the preload, or
`DaemonClient` (which is generic over method + params).

**The owner is never sent by the client.** The daemon resolves it from `IUserContext`, exactly as
`projects.*` and `workspace.*` already do.

## Methods (`packages/ipc-contract/src/document.ts`)

```ts
export const DOCUMENT_GET_STATE_METHOD = 'document.getState';
export const DOCUMENT_SET_STATE_METHOD = 'document.setState';
export const DOCUMENT_MOVE_PATH_METHOD = 'document.movePath';
export const DOCUMENT_PRUNE_METHOD = 'document.pruneMissing';

/** Per-document state, keyed by project + project-relative path. */
export interface DocumentStateDto {
  projectId: string;
  /** Project-relative path, normalised case/separator-insensitively (the 004 normalise). */
  relPath: string;
  /** The manual language override; null when none. A stale id is PRESERVED, never rewritten. */
  languageId: string | null;
}

export interface DocumentGetStateParams { projectId: string; relPath: string }
export interface DocumentGetStateResult { state: DocumentStateDto | null }

export interface DocumentSetStateParams { projectId: string; relPath: string; languageId: string | null }
export interface DocumentSetStateResult { state: DocumentStateDto }

/** Carry a document's state with the file across an in-throng rename or move (FR-028e). */
export interface DocumentMovePathParams { projectId: string; fromRelPath: string; toRelPath: string }
export interface DocumentMovePathResult { moved: boolean }

/** Drop rows whose file no longer exists, so the table cannot grow without bound. */
export interface DocumentPruneParams { projectId: string }  // AMENDED — see the note below
export interface DocumentPruneResult { pruned: number }
```

### `document.movePath`

**FR-028e**: *"A rename or move within throng MUST carry the row with the file."* Without this, renaming a
file **silently drops its language override** — the user's explicit decision, discarded by a rename.

It is a **single atomic statement** (`UPDATE document_state SET rel_path = ? WHERE owner_user = ? AND
project_id = ? AND rel_path = ?`), not a client-side get→set-new→delete-old sequence: that sequence is three
round-trips with two windows in which a crash leaves the override **duplicated** or **lost**.

- `moved: false` when there was no row (the common case — most files carry no override). **Not an error.**
- If a row already exists at `toRelPath` (the rename clobbered an existing file), the moved row **wins** —
  it describes the file that now lives there.

**Callers — the part that is easy to forget.** Two paths change a file's project-relative path, and **both**
must call this or the override is lost:

1. the File Explorer's **rename/move** (`file.rename`, and drag-move within the tree);
2. the editor's **Save-As** (`editor-coordinator.save`, which already re-points the open registry).

## Semantics

### `document.getState`
Returns the row, or `{ state: null }` when there is none. **Never throws for an unknown path** — a file
with no override is the normal case, not an error.

### `document.setState`
Upserts on `(owner_user, project_id, rel_path)`.

- `languageId: null` **deletes** the override (the user chose "detect normally"), leaving no row.
- `languageId: '<id>'` stores it **verbatim**, including an id the current registry does not know. The
  daemon does **not** validate against the registry: **FR-005b requires a stale id be preserved**, so a
  build that reintroduces the language resolves it again. Validation is a *resolution-time* concern
  (it falls through the precedence chain), not a *storage-time* one.
- Storing `'plaintext'` is a **decision, not an absence** (FR-004c) — it is a real row, and it terminates
  precedence. It must **not** be collapsed to `null`.

### `document.pruneMissing`
Removes rows for the project whose `relPath` is not in `existingRelPaths`. Idempotent. Called
opportunistically; never on the open path (it must not cost the user latency on a file open).

## Errors

| Condition | Code |
|---|---|
| Missing/invalid params | `JSON_RPC_INVALID_PARAMS` (-32602) |
| Unknown `projectId` | `JSON_RPC_NOT_FOUND` (-32004) |

## Persistence

Table `document_state` (see `data-model.md` §9). Cascade on project delete is **free** via the FK plus the
per-connection `PRAGMA foreign_keys = ON`.

## Tests

- **Integration** (`packages/daemon/tests/integration/document-ipc.integration.test.ts`) — spins a real
  `IpcServer` on a unique pipe against a real temp SQLite DB, following
  `projects-ipc.integration.test.ts`. Covers: set → get round-trip; `null` deletes; **a stale id
  round-trips unchanged**; `'plaintext'` is stored as a row and **not** collapsed to null; prune drops
  only missing paths; **deleting the project cascades** the rows away.
- **Migration** (`packages/persistence/tests/integration/migration-v7.integration.test.ts`) — the
  migration is **idempotent** (re-running it, and running it against an already-migrated store, converge
  on the same state); `LATEST_VERSION` becomes 7; the table and index exist.
- **Retired guards** — `no-editor-migration.integration.test.ts` and `user-version-pin.integration.test.ts`
  are rewritten to assert the **new** intent (an editor table now legitimately exists at v7), not deleted.


---

## Amendment (2026-07-13, during implementation) — `document.pruneMissing` takes only the project id

**As drafted**, prune received `existingRelPaths: string[]` — the client enumerating every file that still
exists, and the daemon deleting every row not in that list.

**That shape is a data-loss trap.** "Delete every row I was not told about" is only safe if the caller
supplies a COMPLETE list. Its one caller is project open, where FR-028e explicitly forbids sitting on the
critical path — so the lists cheaply available there are partial (a shallow directory listing; a lazily
expanded tree). A partial list does not prune less. It **silently deletes every override in every
subdirectory the caller did not walk** — the user's explicit decisions, erased by opening the project.

**Amended**: the client sends only `{ projectId }`. The daemon already knows the project's root folder (it
owns the project store), so it resolves each **row** against the filesystem and drops the ones whose file is
gone.

- **Correct by construction** — an incomplete enumeration cannot happen, because there is no enumeration.
- **Cheaper** — O(rows), not O(files in the project). A file with no override is never even looked at, and
  most files have none.
- **Fails safe** — a project whose root cannot be resolved (an unreachable network share) prunes
  **nothing**. "I cannot see the folder" must never be read as "none of these files exist".
