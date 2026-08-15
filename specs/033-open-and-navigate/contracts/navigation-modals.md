# Contract: the two navigation modals

**Modules**: `packages/ui/src/renderer/navigate/{navigation-chrome.tsx, navigation-store.ts, quick-open.tsx, quick-open-target.tsx, goto-line.tsx, use-file-index.ts}` (all new) · `packages/core/src/editor/goto-line.ts` (new, pure) · `packages/ui/src/renderer/app.tsx` · `packages/ui/src/renderer/composition-root.tsx`

**Requirements**: FR-001–FR-003, FR-008–FR-012, FR-018–FR-028, FR-057–FR-067 · SC-001, SC-004, SC-006, SC-007, SC-012, SC-014

## 1. Mounting and scope

`NavigationChrome` is mounted by **both** composition roots — `CompositionRoot()` and
`SubWorkspaceCompositionRoot({ id })` — beside `EditorChrome`. A chord that worked in one window and did
nothing in the other is the failure Assumption 6 rejects.

| # | Guarantee | Requirement |
|---|---|---|
| A1 | `navigate.quickOpen` is dispatched by the **window-level** capture listener in `app.tsx`, from the `HANDLED` allowlist. It reaches the app from a focused terminal with **no terminal-specific special case** | FR-001, FR-003 |
| A2 | `navigate.gotoLine` is `EDITOR_ONLY`, dispatched by a window listener gated on `getActivePane() === 'workspace'` and on the active panel being an editor — the shape `editor.save` and `search.find` already use. It is **not** added to the CodeMirror keymap | FR-025 |
| A3 | With a terminal focused, `resolveAction` returns `null` for `Ctrl+G`, nothing is preventDefaulted, and xterm delivers `^G` to the shell | FR-025, SC-007 |
| A4 | With no active panel, `navigate.gotoLine` does nothing | FR-025 |
| A5 | With no project open — no root for this window (R6) — `navigate.quickOpen` does **not** open the modal, and never lists a previous project's files | FR-018 |

## 2. The one-modal slot

```ts
type NavigationModal =
  | { kind: 'quickOpen'; invokedFrom: { editorPanelId: string } | null }
  | { kind: 'gotoLine'; panelId: string }
  | null;
```

| # | Guarantee | Requirement |
|---|---|---|
| S1 | One slot. Opening either modal while the other is open replaces it — exactly one is on screen | FR-066 |
| S2 | Neither can be opened twice; a second request while it is open is a no-op | FR-066 |
| S3 | Both match the app's shipped modal presentation: `.modal-overlay` scrim, a dialog card with `role="dialog" aria-modal="true"`, `useFocusTrap`, focus in the input on open, Escape cancels, Enter confirms | FR-065 |
| S4 | **Nothing under `navigate/` imports from `search/search-store.ts`.** A find bar closes when its user closes it or its editor closes, and by no other route | FR-026a |
| S5 | Neither modal changes the **active panel**, which is what would make `closeFindIfNotOn` close a find bar as a side effect | FR-026, FR-026a |

## 3. Quick Open — routing a choice

Every route ends in a function that already exists, which is what makes SC-004 provable rather than
promised.

| Situation | Call | Requirement |
|---|---|---|
| No target control (invoked outside an editor) | `openFileInTab(ws, activeTabId, absPath, settings.editor.openTarget)` | FR-009, FR-011 |
| Target control on "the currently active editor" | `openFileInTab(ws, activeTabId, absPath, 'lastActive')` | FR-010, T5 |
| Target control on "a new editor panel in this tab" | `openFileInNewEditor(ws, activeTabId, absPath)` | FR-010 |

| # | Guarantee | Requirement |
|---|---|---|
| Q1 | The absolute path is `root + '/' + relPath`, the root being the window's own (R6). Quick Open never composes a path from anything else | FR-005 |
| Q2 | The **one-buffer rule** is inherited: `openFileInTab` calls `window.throng.editor.openInto({ absPath })` first, and a `'focus'` decision focuses the existing editor rather than opening a second copy | FR-008, SC-004 |
| Q3 | The **unsaved-changes prompt** is inherited: a dirty target reaches `promptUnsavedOpen`, and Cancel leaves the buffer untouched | FR-008, SC-004 |
| Q4 | A tab with **no** editor gets one created, by `createDedicatedEditor` on the existing path | FR-008 |
| Q5 | The modal closes on choose; the file opening is what the user asked for and the modal has no further job | FR-001 |
| Q6 | Escape closes, opens nothing, and returns focus to the surface the user came from — `picker.tsx`'s shipped render-phase capture | FR-012 |
| Q7 | Every outcome is identical to the equivalent route from the tree, because it **is** the route from the tree | SC-004 |

## 4. Quick Open — the visible route

| # | Guarantee | Requirement |
|---|---|---|
| V1 | The Files & Folders toolbar carries a Quick Open button, beside Expand and Collapse all, opening the same modal the chord opens | FR-018a |
| V2 | Its icon is `<Icon token="quickOpen" />` — a theme token, never a hard-coded glyph or inline SVG | FR-018b |
| V3 | Its hover title names the action **and the command's current chord**, read live via `firstBinding(keybindings, 'navigate.quickOpen')`, so a rebound chord is reflected without a restart | FR-018a, AS-17 |
| V4 | With no project open it is **drawn and disabled**, not hidden — temporarily unavailable, not meaningless | FR-018c |
| V5 | It is the only new toolbar control; Expand, Collapse all, New folder and Delete are untouched | FR-046 |

## 5. Go To Line

```ts
// packages/core/src/editor/goto-line.ts  (pure)
/** null for empty, whitespace or non-numeric input; otherwise clamped into [1, lineCount]. */
export function resolveGotoLine(raw: string, lineCount: number): number | null;
```

| # | Guarantee | Requirement |
|---|---|---|
| G1 | A line that exists scrolls into view with the caret at its **first column** | FR-021 |
| G2 | The line reached is the line whose number the **gutter** shows. `lineNumbers()` draws logical lines and `doc.line(n)` is the same logical line, so this holds wrapped and unwrapped alike | FR-021, SC-006 |
| G3 | A number greater than the document's line count resolves to the **last** line; `0` and negatives to the **first**. Neither raises an error notice | FR-022 |
| G4 | Empty, whitespace, non-numeric or cancelled input leaves caret, selection and scroll position **unchanged** | FR-023 |
| G5 | An empty document has one line, so any number resolves to line 1 | Edge Cases |
| G6 | Escape closes without moving anything | FR-024 |
| G7 | Focus returns to the **editor** on both confirm and cancel — by calling `getEditorView(panelId)?.focus()` explicitly, **not** by restoring the captured `activeElement`, which would return it to a focused find bar | FR-024, FR-026 (R10) |
| G8 | An open find bar in the same editor keeps its query, its match count and its highlights, and merely loses focus | FR-026 |
| G9 | Go To Line appears on the editor's content menu showing its current chord | FR-027 |
| G10 | No second go-to-line surface is reachable — `@codemirror/search`'s panel is not mounted | FR-028 |

## 6. Remembering what was typed

| # | Guarantee | Requirement |
|---|---|---|
| M1 | With both settings at their defaults, both modals open **empty**, every time | FR-057, SC-014 |
| M2 | A value is recorded only when the modal **accepted** it — a query that opened a file, a number that was gone to. Escape records nothing | FR-061 |
| M3 | When its setting is on, the value is restored **fully selected**, so typing replaces it | FR-060 |
| M4 | Quick Open with a restored query shows that query's **results**, not an empty list | FR-060 |
| M5 | Values live per window for the running application only and are **never written to disk** | FR-062 |
| M6 | Quick Open's remembered query is discarded when the **active project changes** | FR-062 |
| M7 | Turning a setting off takes effect at the next invocation and **discards the value already held** | FR-063 |
| M8 | Each setting is asserted in **both** states — a rendered setting nothing reads is the defect #108 exists to catch | SC-014 |

## 7. Discoverability and documentation

| # | Guarantee | Requirement |
|---|---|---|
| P1 | Both commands appear in Preferences → Key Bindings with a name and a description, are rebindable, and after a rebind the new chord works while the old one stops | FR-064, SC-012 |
| P2 | Both settings appear in Preferences → Settings under `Editor · Navigation`, each with a `FieldDescriptor`, so the completeness gate passes | FR-059 |
| P3 | `docs/quick-start.md` gains both chords in its shortcut table, both new explorer actions, and both preferences | FR-067 |
