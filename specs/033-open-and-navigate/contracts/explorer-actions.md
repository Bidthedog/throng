# Contract: the two new explorer actions

**Modules**: `packages/core/src/explorer/subtree.ts` (new, pure) · `packages/ui/src/renderer/explorer/{file-tree.tsx, context-menu-items.ts, use-explorer-data.ts}` · `packages/ui/src/renderer/panel-type/use-flavours.ts` · `packages/core/src/terminal/{panel-type.ts, start-directory.ts}` · `packages/ui/src/main/terminal-ipc.ts`

**Requirements**: FR-029–FR-037 (Open In → Terminal) · FR-038–FR-046 (Expand / Collapse All Children) · SC-008, SC-009, SC-015

---

## Part A — Open In → Terminal (US3)

### A.1 The submenu

`Terminal` is appended to the `Open In` submenu that `context-menu-items.ts` already composes, for both
folders and files. Its children are the flavours.

| # | Guarantee | Requirement |
|---|---|---|
| A1 | The Terminal submenu is nested **inside** the existing `Open In` submenu — a third level. `MenuItem.submenu` already nests to any depth, and the panel header's `Sync to → sub-workspace → tab` is the shipped three-level precedent | FR-029 |
| A2 | Its entries come from `useFlavours()`, the **same** catalogue the panel type-picker reads (`window.throng.terminal.listFlavours()` → `mergeFlavours(detected, settings.terminals)`). A user-defined flavour appears with no extra wiring; a disabled built-in does not appear. **No second copy of the list exists** | FR-030, FR-037 |
| A3 | With no active project the Terminal parent is **drawn and disabled**, not hidden | FR-035 |
| A4 | The three-level path is traversable by mouse without an intermediate flyout collapsing — `#157` fixed that, and `behaviour.submenuHoverMs` governs the dwell | FR-036 |
| A5 | The same path is traversable by keyboard: ArrowRight opens each level and focuses its first item, Enter on a flavour launches | FR-036 |
| A6 | Every one of these items declares `section: 'navigate'`; the submenu is single-section and therefore divider-free | FR-047, FR-049 |

### A.2 Launching

The panel is created by **the sequence `createDedicatedEditor` uses**, which is stated as a sequence
rather than a reference because each step exists for a reason FR-033 names:

```
ws.addPanel(activeTabId)                                    → a new panel in the ACTIVE tab
ws.clearLastAddedPanel()                                    → NOT rename mode (only user-added panels rename on add)
ws.setPanelType(id, 'terminal', { flavourId, shellArguments, startDirectory })
window.throng.panel.notifyTyped(id, 'terminal', config)     → mirror the typing to other windows
ws.setActivePanel(activeTabId, id)                          → the active panel
focusPanel(id)                                              → and it takes KEYBOARD focus (FR-033a)
```

| # | Guarantee | Requirement |
|---|---|---|
| B1 | A new terminal panel opens in the **active tab** and becomes the active panel | FR-031, FR-033 |
| B2 | It does **not** open in rename mode | FR-033, AS-2a |
| B3 | It takes **keyboard focus**, so the next keystroke reaches the shell with no intervening click. Focus does not remain in the tree | FR-033a, SC-015 |
| B4 | The start directory is the right-clicked **folder**, or a right-clicked **file's parent folder** | FR-031 |
| B5 | `startDirectory` is persisted on `TerminalPanelConfig`, so a restored panel restarts where it was created | FR-033 |
| B6 | The cwd is resolved by the shipped `resolveStartDirectory(root, requested, dirExists)` with `requested = rememberedCwd ?? startDirectory`. **Containment is therefore inherited**: a path resolving outside the project root is refused and the root is used instead | FR-032 |
| B7 | A start directory that no longer exists at launch falls back to the project root and **says what was substituted**, via the shipped `fallbackToReport` → `cwdFallback` on the attach envelope | FR-034 |
| B8 | Nothing about the flavour catalogue or its configuration UI changes | FR-037 |
| B9 | The terminal starts in the right-clicked folder for **every enabled flavour on the machine** | SC-008 |

**One line changes in `packages/ui/src/main/terminal-ipc.ts`**: which value is passed to
`resolveStartDirectory` as `requested`. Everything else on that path — the containment check, the
existence check, the fallback, the report — is untouched, which is the point.

---

## Part B — Expand / Collapse All Children (US4)

### B.1 Pure core

Beside `nextExpandTargets` in `packages/core/src/explorer/expand.ts`, over the same `ExpandNode` view:

```ts
// packages/core/src/explorer/subtree.ts  (new, pure)
/** Every OPEN folder strictly beneath `relPath`, at every depth. Deepest first. */
export function descendantOpenFolders(root: ExpandNode, relPath: string): string[];

/** The IMMEDIATE child folders of `relPath` — one level, never recursive. */
export function immediateChildFolders(root: ExpandNode, relPath: string): string[];
```

| # | Guarantee | Requirement |
|---|---|---|
| C1 | `descendantOpenFolders` excludes the anchor itself, so the folder stays open | FR-039 |
| C2 | It returns every open descendant at **every** depth, deepest first, so closing is a single pass | FR-039 |
| C3 | It returns `[]` for a folder with nothing expanded beneath it — the caller then changes nothing and errors on nothing | FR-040 |
| C4 | `immediateChildFolders` returns **one level only**; a grandchild is never included | FR-041 |
| C5 | Both are pure and DOM-free, and reuse `ExpandNode` rather than defining a second tree view | Principle VIII |

### B.2 Driving the tree

Both actions go through `use-explorer-data.ts` and use the **same** `ensureLoaded` → `api.open` →
`persist` path a chevron click and the toolbar's `expandStep` already use.

| # | Guarantee | Requirement |
|---|---|---|
| D1 | **Collapse All Children** closes every expanded descendant at every depth and leaves the anchor **open** | FR-039, AS-4 |
| D2 | On a folder with nothing expanded beneath it, nothing changes and nothing errors | FR-040 |
| D3 | On the project **root**, the root stays open — it is the tree | Edge Cases |
| D4 | **Expand All Children** opens the anchor's immediate child folders only | FR-041 |
| D5 | On a **closed** folder it opens the folder first, then its immediate children | FR-042 |
| D6 | Every folder opened by either action has its children **loaded** — `await ensureLoaded(rel)` precedes `api.open(rel)`, exactly as `expandStep` does. **Zero folders end up marked open with unloaded children** | FR-043, SC-009 |
| D7 | Neither action expands into a folder the exclusion rules exclude. `fetchChildren` filters by `isExcluded` and the per-project `hiddenPaths`, so an excluded folder is not in the tree to expand | FR-044 |
| D8 | Both call `persist(selectedId)` on completion, so the resulting open state survives a project switch and a restart exactly as a manual expand or collapse does — the same `localStorage` key, the same shape | FR-045, AS-10 |
| D9 | The toolbar's Expand and Collapse all are **unchanged**, in code and in behaviour | FR-046, AS-11 |
| D10 | Expand All Children on a folder with hundreds of immediate children completes without the tree appearing to hang: loads are issued together (`Promise.all`) and the opens applied in one pass, as `expandStep` does | Edge Cases |

### B.3 Where the items are drawn

| # | Guarantee | Requirement |
|---|---|---|
| E1 | A **folder's** menu offers Collapse All Children and Expand All Children, in that order, in the **Navigate** section after Copy Path | FR-038, FR-047 |
| E2 | A **file's** menu draws **neither item at all** — not as a disabled row. A file can never acquire children, so the control is structurally meaningless, and Principle VI's test ("would any future state enable it?") answers no | FR-038 |
| E3 | Neither item takes a key binding or a toolbar button | Out of scope |

---

## Part C — How the success criteria are proved

| Criterion | Layer | How |
|---|---|---|
| SC-008 (100% of attempts, every enabled flavour) | **E2E** | Launch from a nested folder for each flavour `listFlavours()` reports on the machine; read the shell's reported cwd |
| SC-015 (typed input with no intervening click, every flavour) | **E2E** | Immediately after launch, `keyboard.type` and assert the characters reach the shell |
| SC-009 (zero folders open with unloaded children) | **unit + E2E** | Unit: `immediateChildFolders` / `descendantOpenFolders` over fixtures. E2E: after both actions, assert every open folder renders at least one child or is genuinely empty on disk — the desync that produced #120 |
| FR-045 (persistence) | **E2E** | Run an action, switch project and return; then reload the window; assert the same open state both times |
| FR-032 (containment) | **unit** | `resolveStartDirectory` already has this coverage; a case is added for a `startDirectory` outside the root |
