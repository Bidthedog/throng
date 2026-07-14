# Contract: The operating-system file drop

The largest and riskiest story. It crosses the renderer, the main process and an already-shipped
confinement rule, and it must coexist with two existing drag systems without hijacking either.

## The seam — and why it exists

```text
File  ──[ webUtils.getPathForFile ]──►  absPath  ──►  pure, path-taking handler
      ▲                                             ▲
      the ONE line E2E cannot reach                 everything below is verified through the running app
```

Electron 43 removed `File.path`. `webUtils.getPathForFile` is the only way to obtain a real filesystem
path from a dropped file.

**A file synthesised in the renderer is not an operating-system file, and the extractor returns an empty
string for one.** A fabricated `drop` event therefore **cannot** exercise the real path extraction, and
any test claiming to would be asserting a fiction.

So the seam is not decoration. It is what allows the open, the reject, the focus and the sub-workspace
behaviours to be verified **honestly** through the running application, by driving the path-taking
handler directly. The one-line adapter above it is the only part end-to-end coverage cannot reach, and
that limitation is **stated** (FR-066a) rather than papered over.

This mirrors a seam the application already has: the `throng:open-file` event.

## The decision is made in main, not trusted from the renderer

```ts
type DropRejection =
  | 'outside-project'   // project-owned panel; the file resolves outside its folder
  | 'inside-project'    // sub-workspace panel; the file resolves inside a loaded project
  | 'is-folder'         // a folder is not a document
  | 'too-large'         // exceeds editor.maxOpenFileBytes
  | 'not-found';

type DropResolution =
  | { ok: true;  absPath: string }        // realpath-resolved
  | { ok: false; reason: DropRejection };

// main ← renderer
'throng:editor:resolveDrop': (req: {
  rawPath: string;
  ownerKind: 'project' | 'subworkspace';
  ownerRoot: string | null;
  allProjectRoots: readonly string[];
}) => Promise<DropResolution>;
```

**The path is resolved to its real location — symbolic links followed — *before* the ownership rule is
applied** (FR-057). A link must not be usable to escape a project boundary.

The rule itself is **not new code**: `resolveSaveConfinement` in `@throng/core` already expresses it and
is reused unchanged. What is new is *applying it on the read side*.

## The load path is brought into line with the save path

`LoadResult` gains a reason: **`out-of-tree`**.

This is not cosmetic bookkeeping. Today a rejected load returns a generic I/O reason, which the renderer
classifies as a **missing file** — and that notice is **suppressed** when the user has turned off
missing-file warnings.

**So the silent no-op that FR-061 prohibits already exists on the load path.** It cannot be fixed at the
user interface alone; the reason must be distinguishable at the boundary.

### What the load path gains

| | Save path (today) | Load path (today) | Load path (after) |
|---|---|---|---|
| Resolves symlinks | ✅ | ❌ | ✅ |
| Project-owned: confine to owner's tree | ✅ | ⚠️ **raw path**, skipped if owner root unknown | ✅ resolved |
| Sub-workspace: outside every project | ✅ | ❌ **absent** | ✅ |
| Distinguishable rejection reason | ✅ | ❌ collapses to "missing file" | ✅ `out-of-tree` |

**This is a deliberate behaviour change to shipped code.** A sub-workspace editor that could previously
open an in-project file no longer can. It closes a trap in which the refusal only surfaced at save time —
after the user had already typed their work. Read scope and write scope now agree (SC-012).

And the symlink hole **runs both ways**: today a link *inside* a project that resolves *outside* it opens
fine and fails only at save.

## Drop behaviour

| Case | Behaviour |
|---|---|
| Editor panel, file inside its project | Opens in that panel. |
| **Untyped** panel | Becomes an editor panel showing the file — **without** the user first choosing a panel type. |
| File already open in another panel | **Focuses the existing panel.** One buffer per file. |
| Multiple files | Each opens. |
| A folder | **Rejected.** Unbounded, and a folder is not a document. |
| Any rejection | A **visible** affordance explaining why — never a silent no-op. Sub-workspace rejections say the file belongs to a project. |

## Coexistence with the two existing drag systems (FR-063)

| System | Mechanism | Collision |
|---|---|---|
| **Panel drag** (`@dnd-kit`) | Pointer events only. Registers **no** `dragover`/`drop` handler. | **None.** |
| **Explorer tree** (`react-dnd`) | A **window-level** `dragover` listener that rewrites `dataTransfer.dropEffect` on **every** drag reaching the window — **with no check for whether it is an OS file drag** — and whose default effect is `move`. | **Yes.** Bound on `window` in the bubble phase, so it runs *after* the panel's own handler and overwrites `copy` with `move`. The user would see a *move* cursor for an OS file drag, and some shells act on that. |

**Fix**: gate the explorer's window listener on `dataTransfer.types.includes('Files')`.

It is mounted only while the explorer tree is ready — i.e. **main window only**. Sub-workspace windows
have no explorer, so drag behaviour genuinely differs between the two, and both must be covered.

## The navigation hole this must close (FR-061a)

**There is no `preventDefault` on a window-level `dragover`/`drop` anywhere in the application today, and
no navigation guard.**

So a file dropped anywhere in throng right now makes the renderer **navigate away to that file**,
destroying the running workspace. It is a live defect — and inviting the user to drag files onto the
application is precisely what makes it likely to be hit.

An application-level `dragover`/`drop` guard is added in the same change.
