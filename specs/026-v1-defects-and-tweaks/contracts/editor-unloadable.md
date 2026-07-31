# Contract: editor unloadable state + Reload from disk

**Owner**: `packages/ui/src/main/editor-coordinator.ts` (authority) ·
`packages/ui/src/renderer/editor/*` (presentation)
**Drives**: FR-013, FR-013a, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019

## The problem being modelled

A document can be *open and showing text* while its path is unreadable. Today nothing represents that,
so the renderer cannot tell the difference and neither can the user — the panel looks ordinary and a
save would put remembered text over a path the app could not read.

`fileMissing` already exists but means something narrower and carries a side effect: it is set when a
**delete** is observed on an open file and deliberately force-dirties the buffer, because the buffer
has become the only copy. A document restored against a path that never resolved is not dirty and has
no unsaved user work — force-dirtying it would make every later "save before closing?" prompt ask
about a document with nothing to save.

## State

One additive flag on the document, and on the existing sync message to the renderer:

```ts
/** The path could not be READ. Distinct from `fileMissing` (observed deletion, force-dirties). */
unloadable?: boolean;
```

| Transition | Trigger |
|---|---|
| → `unloadable = true` | a load or reload of the document's path fails |
| → `unloadable = false` | any successful read of that path (auto-recovery, or Reload from disk) |

`unloadable` **must not** alter the dirty flag. It is a statement about the path, not about the buffer.

## Operations

| Operation | Contract |
|---|---|
| `reloadFromDisk(panelId)` | Re-reads the path and replaces the document through the existing document-replace path. Succeeds from the unloadable state. Warns first if the buffer has unsaved edits (FR-016). Distinct from `revert()` — different source of truth, different behaviour when the file is gone (FR-017). |
| `retryUnloadable(paths)` | For every document currently `unloadable` under any of `paths`, attempt the same re-read; clear the flag on success, leave it on failure. Idempotent and safe to call on every file-change broadcast (research R5). |
| `revert()` | **Unchanged.** Still resets to cached `savedText`; still refuses when `savedText === null`. |

## Presentation

| # | Requirement | Observable |
|---|---|---|
| P1 | While `unloadable`, a banner renders **above** the content, inside `.editor-panel-wrap` | `editor-unloadable-<panelId>` |
| P2 | The banner names the path it could not read | banner text contains the file name |
| P3 | The banner states the text below is the last content read, not the file | banner copy |
| P4 | The banner offers **Reload from disk** | control inside the banner |
| P5 | The remembered text stays visible — it may be the user's only copy | `.cm-content` still populated |
| P6 | Saving while `unloadable` asks for confirmation first, then proceeds if confirmed | confirm dialog; never blocked, never redirected (FR-013a) |
| P7 | **Reload from disk** appears in the panel header menu beside Revert, with its chord if bound | `menu-item-Reload from disk` (Constitution VI, FR-018) |
| P8 | The banner clears when the path becomes readable, in place — same panel, tab and panel name | banner gone, content updated |

The banner is themed with existing `--throng-*` tokens; it introduces no literal colours (the
no-inline-artwork guard walks CSS and TSX).

## Two decisions the analysis pass forced

### D2 — **Reload from disk is menu-only. No chord, no `ActionId`.**

FR-018 says the menu item shows "its chord if one is bound". None is bound, so it shows none.

*Why*: Constitution VI requires every discrete panel command to have a **menu item** — it does not
require a chord. Minting an `ActionId` would oblige a default chord, a `COMMAND_SCOPES` entry and a
`KEYBINDINGS_METADATA` descriptor (the configuration-editor completeness gate asserts every
`ActionId` is described), i.e. a keybinding decision nobody asked for, on a recovery action used
rarely and always from a panel already under the pointer. A user who wants one can bind it once the
command exists as an action — that is a later, cheap addition; the reverse is not.

*Consequence*: `keybindings-metadata.test.ts` stays green untouched, because no `ActionId` is added.

### D6 — **The banner's Reload control is a themed icon with a hover title.**

*Why*: "Action controls MUST be themeable icons with hover titles" is NON-NEGOTIABLE, and the
exemption is for **dialog decision buttons** only. A banner is not a dialog, so the exemption does
not reach it.

*Shape*: icon from the active theme's icon set, `title="Reload from disk"`, an accessible name to
match. The banner's explanatory text is prose, not a control, and stays as text.

## Naming note

The committed test `editor-stranded-recovery.e2e.ts` asserts `editor-unloadable-<panelId>`, chosen as a
placeholder before this contract existed. This contract **adopts** that name, so the test needs no
change. Recorded because the spec's Assumptions section flags it as the one place a committed test
might have had to move.
