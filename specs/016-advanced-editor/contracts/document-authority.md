# Contract — the document authority change stream (view ↔ UI main)

**Requirement**: FR-028f · **Constitution**: Principle XI, *"One document, one state"* (v3.15.0)
**Transport**: Electron IPC, renderer ↔ UI main. **Not** daemon RPC — the document never leaves the UI
process pair, and the daemon has no business holding an editing buffer.

This is the one protocol in feature 016 where **getting the message shape wrong corrupts the user's
file**, silently. It gets a contract for the same reason the clipboard seam does.

> **Amended during implementation (2026-07-13).** Three clauses of the original draft were wrong, and
> each is corrected below with its reasoning kept in place rather than deleted: the **replica model**
> (the originator must NOT re-apply its own change), the **dirty derivation** (`version !== savedVersion`
> reports a document as unsaved after it has been undone back to its saved content), and the **identity**
> carried on each message (`panelId` cannot distinguish two mirrored views of one panel). See
> *Amendments*, below.

## The rule it implements

> Exactly **one** component owns the document state; every other copy is a **derived replica**, changed
> only by applying that authority's **ordered change stream**. Peer-to-peer reconciliation between
> co-equal copies is **forbidden**. A change based on a superseded version MUST be **rebased** onto the
> authority's current version, never applied at the position it originally named.
> — constitution, Principle XI

**UI main is the authority.** Each `EditorView` is a replica. The shipped code does the opposite — two
views relaying `{text, dirty}` to each other, each its own source of truth — and replacing that is the
substance of this contract.

## Messages

Defined in `packages/core/src/editor/document-sync.ts` — in **core**, because both ends must agree on
them and neither end may own them.

```ts
/** replica → authority. The user has ALREADY seen this applied locally (typing must not wait). */
export interface DispatchChangeMsg {
  documentId: string;
  viewId: string;            // the originating VIEW, not the panel — see Amendment 3
  changes: unknown;          // CodeMirror ChangeSet, serialised with toJSON()
  baseVersion: number;       // the document version this was computed against — MAY be stale
  selectionBefore: unknown;  // cursor/selection set, for the undo entry (FR-026a)
  mergeClass?: 'type' | 'delete' | null;  // may this coalesce into the run above it? (FR-026)
}

/** authority → ALL replicas (the originator included). The single ordered canonical stream. */
export interface CanonicalChangeMsg {
  documentId: string;
  kind: 'edit' | 'undo' | 'redo';  // an edit's originator has applied it; an undo's invoker has NOT
  changes: unknown;          // possibly REBASED — NOT necessarily what the view sent
  version: number;           // the document version AFTER this change
  dirty: boolean;            // DERIVED by the authority — never relayed by a view
  origin: string;            // the view that dispatched the edit / invoked the undo
  selection?: unknown;       // an undo's recorded cursor set — restored in the INVOKING view only
}

/** authority → ALL replicas. The document was REPLACED: a revert, an external reload, a resync. */
export interface ResetDocumentMsg {
  documentId: string;
  text: string;
  version: number;
  dirty: boolean;
}
```

## Semantics

### Applying a dispatched change

| `baseVersion` vs current `version` | The authority MUST |
|---|---|
| **equal** | apply, `version++`, broadcast |
| **stale** (`<`) | **rebase** via `ChangeSet.map()` over the intervening changes, apply the rebased form, `version++`, broadcast the **rebased** change |
| **ahead** (`>`) | **fail loudly.** A replica cannot outrun its authority; this is a bug, and guessing would corrupt the document |
| **older than the rebase window** (the document was replaced under it) | **drop it**, and resynchronise the view that sent it — see *Errors* |

- A stale change is **NEVER rejected.** The view has already shown the user their keystroke; rejecting it
  would visibly revert input the user watched themselves type. Rebase, don't refuse.
- Every replica applies each canonical change with **`addToHistory: false`** — it is not that view's
  action, and the undo stack lives with the authority (FR-026c).
- **The originator applies nothing when its own `edit` is acknowledged** (Amendment 1).

### The replica

A replica keeps **at most one change in flight**, composing anything typed meanwhile into a buffer that
is sent on the next acknowledgement. `baseVersion` is a single integer: it can say *"computed against
version N"*, but it cannot say *"…and also on top of my own two unacknowledged edits"*, so a second
change sent while the first was still out would be rebased over that first change by the authority — and
applied twice over.

On each canonical change it does **not** originate, a replica rebases the incoming change over whatever
it still holds pending, and its pending changes over the incoming one, with the **complementary
tie-break** (`incoming.map(pending, true)` against `pending.map(incoming)`). Both ends therefore compute
the *same* rebase from the same inputs — which is what makes Amendment 1 sound.

### Dirty state

**Derived by the authority**, by comparing the document with the content last written to disk. A view
MUST NOT relay a `dirty` flag: that would make it a second peer-owned value, which is what Principle XI
forbids. Undo past a save re-dirties the document for free (FR-026d), with no special case — and undo
*back to* the saved content makes it clean again (Amendment 2).

## Errors

| Condition | Behaviour |
|---|---|
| `baseVersion` ahead of `version` | throw — never silently coerce |
| `baseVersion` older than the rebase window | **drop the change and resync the sending view.** The window closes when the document is REPLACED (a revert, an external reload); the change describes text the user has already discarded, and there is no honest position to land it at |
| Unknown `documentId` | throw — a change for a document with no authority means the buffer was destroyed under a live view |
| Malformed `changes` (not a `ChangeSet.fromJSON`-able value) | throw before applying; a partially-applied change is unrecoverable |

## Amendments

### 1. The originator must NOT re-apply its own change

**The draft said** the originating view *"MUST apply the canonical (possibly rebased) change too,
reconciling its optimistic local copy"*, and called suppressing that echo *"the classic bug here"*.

**As written this applies every edit twice.** The view has already applied its change optimistically —
that is the premise of the whole protocol. Applying the canonical form on top of it inserts the text a
second time: type `X`, get `XX`.

The draft's instinct was sound — *something* must reconcile the originator's optimistic copy when the
authority rebases it — but the reconciliation belongs in the replica, not in a second application of the
change. Because a replica rebases its in-flight change over each canonical change it receives, using the
complementary tie-break, **it derives exactly the change the authority computed**. Its copy is already
correct when the acknowledgement arrives. So the originator advances its version and applies nothing.

This also removes `echoTo`, which existed only to tell a view its copy was wrong. It isn't.

Convergence is now *proven* rather than asserted by a flag: every test in
`undo-shared.integration.test.ts` ends by comparing both replicas against the authority, character for
character.

### 2. `dirty` cannot be `version !== savedVersion`

**The draft said** dirty is *"DERIVED by main (`version !== savedVersion`)"*.

**An undo is not a rewind.** It is the inverse change, applied *forward*, so it **advances** the version
like any other change. Undoing an edit back to exactly the text on disk therefore leaves
`version > savedVersion` — and the document would report unsaved changes while being byte-for-byte
identical to its file. The user would see an unsaved dot on a document they had just pressed Ctrl+Z to
restore, and the next Save-All would rewrite it for nothing.

The version's job is to **order the stream**. Whether the document differs from its file is a question
about *content*, so it is answered by comparing content (`Text.eq`, which short-circuits on length — the
common case costs nothing). The principle the draft was defending is untouched: `dirty` is still derived
by the authority and never relayed by a view.

### 3. The message identity is the VIEW, not the panel

**The draft keyed messages by `panelId`.** But a *mirrored* document is one panel shown in two windows —
`panelId` is exactly what its two views have in **common**. Keyed by panel, the authority cannot tell
which replica sent a change, so it cannot tell an acknowledgement from a remote edit, and both views
would apply their own edits twice.

`documentId` remains the panel (one buffer per file, one authority per open document). The per-message
identity is `viewId`, unique per mounted view.

### 4. `kind` distinguishes an acknowledgement from an undo

An `edit` and an `undo` invoked by the same view both carry that view's `origin`, but they demand
opposite handling: the originator of an edit has already applied it, while the invoker of an undo has
applied nothing and must. Without `kind`, a user who pressed Ctrl+Z while a keystroke was still in
flight would have the undo silently swallowed as though it were their own edit coming back.

## Tests

- **Contract** (`packages/ui/tests/contract/document-authority.contract.test.ts`) — the authority against
  a fake transport: equal-version applies; **stale-version rebases and lands at the mapped position**;
  ahead-version throws; a change whose base document was replaced is **dropped**; dirty is derived, not
  accepted from a view, and is **clean again after an undo back to the saved content**.
- **Integration** (`packages/ui/tests/integration/document-authority.integration.test.ts`) — **SC-013b**:
  two changes dispatched **against the same base version** (the race, *constructed*, not waited for) both
  land, intact and correctly placed. A race that only fires under real timing passes in CI and corrupts a
  file in the field, so it MUST be built deterministically. Plus the undo-run grouping (FR-026) against a
  stopped clock.
- **Integration** (`packages/ui/tests/integration/undo-shared.integration.test.ts`) — the authority and
  **two real replicas** over a controllable wire: the shared stack (FR-026c), the per-document scope
  (FR-026e), the cursor restored to the invoking view alone (FR-026f), replace-all as one entry, and —
  in every test — **both replicas converging on the authority's text, character for character**.
- **E2E** (`packages/ui/tests/e2e/editor-mirrored-undo.e2e.ts`) — mirror a panel into a sub-workspace
  window; type in view A; assert view B shows it; **Undo in view B** reverts A's edit and both views
  agree (SC-013).
