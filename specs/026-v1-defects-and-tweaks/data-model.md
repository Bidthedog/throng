# Phase 1 Data Model: v1.0.0 Defects & Tweaks

This feature adds almost no data. What follows is the state it *changes*, and — for two entities — the
invariant that was being violated. Nothing here is persisted anywhere new.

---

## Open document *(in-memory, UI main; replicated to renderer)*

| Field | Existing | Change |
|---|---|---|
| `absPath` | yes | — |
| `authority.text` | yes | the buffer on screen |
| `authority.savedText` | yes | throng's *belief* about what is on disk; `null` once the file is gone |
| `dirty` | yes | — |
| `fileMissing` | yes | observed deletion of an open file; **force-dirties** (the buffer is now the only copy) |
| `unloadable` | **new** | the path could not be READ. **Must not touch `dirty`.** |

**The invariant this feature restores**: a document displaying text asserts that the text is the file.
When the path cannot be read that assertion is false, and until now nothing recorded the difference —
`authority.text` and "what is on disk" silently diverged with no marker. `unloadable` is that marker.

**Why not reuse `fileMissing`**: it means "a delete was observed" and carries a deliberate
force-dirty. A document restored against a path that never resolved has no unsaved user work;
force-dirtying it would make every later save prompt ask about a document with nothing to save. See
[contracts/editor-unloadable.md](./contracts/editor-unloadable.md).

State transitions:

```
loaded ──(read fails)──> unloadable ──(any successful read)──> loaded
                              │
                              └──(user saves, after confirming)──> written, still unloadable
                                                                    until the next successful read
```

---

## Remembered tree state *(per project, renderer localStorage)*

```ts
{ expanded: string[], selectedId: string | null }   // shape UNCHANGED
```

Keyed by project-relative path. The shape does not change; two rules about it do:

| Rule | Was | Becomes |
|---|---|---|
| A rename's effect on `expanded` | selection migrates, expansion is stranded and then quietly dropped | every entry at or under the renamed folder migrates by prefix, exactly as a move already does |
| An entry that will not resolve on restore | surfaces as a user-facing error naming the old path | discarded silently, and recorded in diagnostics |

**Invariant**: an entry in `expanded` is a claim that a path was open. A rename does not close a
folder, so the claim must move with the path — and a claim that can no longer be checked is dropped,
not reported.

---

## Watch registration *(in-memory, UI main)*

Not previously modelled as state at all — it was a handle and a timer in a closure, which is why its
failure had nowhere to go.

| Field | Purpose |
|---|---|
| `handle` | the live OS watch, or `null` while retrying |
| `burstStartedAt` | when the current coalescing burst began — the field that makes the 1s ceiling possible |
| `pendingTimer` | the trailing debounce timer |
| `retryTimer` / `attempts` | bounded re-establishment after a runtime failure |
| `disposed` | latch; once set, no `onChange`, no `onFailed`, no further retry |

**Invariant**: at most one of `pendingTimer` / `retryTimer` is armed, and neither survives `disposed`.
This is what stops a re-established watch outliving a project switch (FR-011).

Lifecycle:

```
watching ──(fs error)──> retrying ──(success)──> watching
                             │
                             └──(attempts exhausted)──> failed ──> onFailed() once
any state ──(dispose)──> disposed   [terminal; cancels timers, closes handle]
```

---

## Tracked item *(the tree's view of a file or folder)*

No fields change. One rule does, and it is the whole of #194:

**A path differing from another only by letter case denotes the same item on this platform.** The
collision guard treated "the destination name already exists" as proof of a *different* item; on a
case-insensitive filesystem that is false precisely when the two names differ only by case. The guard
now asks "is this destination this same item?" before asking "is something already there?".

---

## Not modelled

- **Diagnostics records** — free-form lines appended to the existing diagnostic log. No schema, no
  retention rule, no new surface (spec Assumptions).
- **Keybinding defaults** — a constant, not state. #165 edits a shipped value; user configs are a
  separate, untouched file.
- **Status bar content** — derived entirely from the project and layout stores; #166 removes reads,
  adds no state.
