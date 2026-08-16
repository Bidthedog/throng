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
| B6 | The cwd is resolved by the shipped `resolveStartDirectory(root, requested, dirExists)` with `requested = rememberedCwd ?? startDirectory`. **Containment is therefore inherited**: a path resolving outside the project root is refused and the root is used instead — including one that walks out with `..`, see the amendment below | FR-032 |
| B7 | A start directory that no longer exists at launch falls back to the project root and **says what was substituted**, via the shipped `fallbackToReport` → `cwdFallback` on the attach envelope | FR-034 |
| B8 | Nothing about the flavour catalogue or its configuration UI changes | FR-037 |
| B9 | The terminal starts in the right-clicked folder for **every enabled flavour on the machine** | SC-008 |

**One line changes in `packages/ui/src/main/terminal-ipc.ts`**: which value is passed to
`resolveStartDirectory` as `requested`. Everything else on that path — the containment check, the
existence check, the fallback, the report — is untouched, which is the point.

> **CORRECTED 2026-08-16, from implementing it.** Two of the statements above were not true of the
> code as it actually is. Both are recorded rather than quietly worked around, because the next
> person to read this contract would have made the same two mistakes.
>
> **`focusPanel(id)` cannot succeed at the point the sequence places it.** It returns `false` unless
> the panel has already called `registerPanelFocus`, and the panel it is handed was created
> microseconds earlier — its terminal view has not mounted. The focus that actually lands today
> comes from `use-terminal.ts`'s `focusIfActive(term)` on mount, which works *only because
> `setActivePanel` runs immediately before*. So the sequence delivers B3, but not by the step the
> sequence credits. The shipped code keeps the `focusPanel(id)` call exactly as written and falls
> back to `requestPanelFocus(id)` — issue 144's parking mechanism, built for precisely this async
> gap — when it returns false. A strict superset of the step, never a replacement for it.
>
> > **AMENDED 2026-08-16, from an adversarial review.** The fallback described above was **inert as
> > first written**, and the paragraph claimed a mechanism that did not run. `terminal-panel.tsx`
> > declared its `registerPanelFocus` effect *before* `useTerminal`, and effects run in declaration
> > order — so the registration happened before `apiRef.current` existed. `registerPanelFocus` fires a
> > parked request immediately and clears the one-shot, so the request was spent on a callback that
> > read a null ref and did nothing. B3 still rested entirely on `focusIfActive`, which is the accident
> > the fallback was added to remove.
> >
> > The fix is ordering, not a new mechanism: that effect now sits **after** `useTerminal` and is gated
> > on `container`. Both are needed. Declaration order alone is insufficient because `container`
> > arrives via `ref={setContainer}`, so `useTerminal`'s mount effect returns early on the first
> > passive flush and `apiRef` is null in it regardless of order; gating means the first registration
> > happens on the flush that actually built the terminal. **The parked request now lands on a live
> > `apiRef`, and B3 is delivered by the step the sequence credits.** The three files carry comments
> > saying so — moving that effect back above `useTerminal` silently re-breaks this.
> >
> > Also recorded rather than changed: `pendingFocusPanelId` is a **single global slot**, so a second
> > `requestPanelFocus` discards the first. That is the right semantic — focus is singular and the
> > later request is the more recent statement of intent — and it is now stated in
> > `workspace/panel-focus.ts` instead of being an unremarked property of the implementation.
>
> **B7 is not inherited by leaving that path untouched — the *value* has to flow.** `fallbackToReport`
> read `req.rememberedCwd` directly, so a `startDirectory` pointing at a folder deleted between the
> right-click and the launch would have fallen back to the project root **silently**, which FR-034
> forbids in the same breath that B7 claims to inherit it. One local is hoisted,
> `const requestedCwd = req.rememberedCwd ?? req.startDirectory`, and passed to both calls. No logic
> inside either function changed. "Untouched and therefore inherited" holds for the containment and
> existence checks; it was false for the report.
>
> > **AMENDED 2026-08-16, from an adversarial review.** Two things this correction claimed were
> > covered, were not.
> >
> > **The `..` hole in the containment B6 inherits.** `isUnderPath` (`packages/core/src/fs/path-id.ts`)
> > was a string-prefix rule: it normalised separators and case and then asked `startsWith(folder + '/')`.
> > `C:/project/../../Windows/System32` passed against root `C:/project`, and `statSync` in
> > `terminal-ipc.ts` — and then the shell — resolved the `..` and started outside the project root.
> > This never mattered before 033 because `rememberedCwd` is the daemon's read of a live OS process's
> > working directory and cannot contain a `..`; **`startDirectory` is the first value on this path
> > that comes from user-editable persisted config** (the workspace layout JSON). The threat model is
> > weak — anyone editing that file can do worse — but `panel-type.ts` says "nothing here is trusted"
> > and B6 says containment "is therefore inherited", and both were stronger than the code. A `..`
> > **path segment** on either side is now refused before the prefix check, deliberately rather than
> > resolved: this module has no filesystem, resolution is platform behaviour it does not have, and
> > "refuse and fall back to the project root" is the right answer for a path it cannot evaluate. Names
> > that merely contain dots (`..config`, `a..b`) are untouched — it is a segment rule.
> >
> > **FR-032 and FR-034 were untested at every layer.** Part C claimed a `startDirectory` containment
> > case had been added to `start-directory.test.ts`; it had not, and neither that file nor
> > `cwd-fallback-report.test.ts` was touched by 033. Reverting the hoisted `requestedCwd` above — the
> > defect this very correction was written to record — left the whole suite green. Both files now
> > carry the cases, `path-id.test.ts` carries the `..` cases, and **one gap is recorded rather than
> > closed**: the precedence expression itself (`rememberedCwd ?? startDirectory`) lives in an Electron
> > IPC handler, so the unit tests MIRROR it and cannot fail on that revert. The honest fix is to move
> > `requestedCwd` into `packages/core/src/terminal/start-directory.ts` beside the two functions it
> > feeds and have `terminal-ipc.ts` call it; `cwd-fallback-report.test.ts` says so at the mirror.
>
> **AS-6 / A3 ("no active project") is not reachable from this menu at all.**
> `panes/file-explorer-pane.tsx` mounts `FileTree` only when a project is active, so with no project
> there is no row to right-click and no menu to inspect — which is why AS-6 is worded *"when a
> context menu is available at all"*. The E2E proves the same rule through the route that **is**
> reachable: every built-in disabled and no user flavours, so the catalogue is empty and the Terminal
> parent must still be drawn `aria-disabled="true"` and open nothing.

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
| D1 | **Collapse All Children** closes every expanded descendant at every depth and leaves the anchor **open**. "Expanded" means expanded **and reachable through open ancestors** — see the amendment below | FR-039, AS-4 |
| D2 | On a folder with nothing expanded beneath it, nothing changes and nothing errors | FR-040 |
| D3 | On the project **root**, the root stays open — it is the tree | Edge Cases |
| D4 | **Expand All Children** opens the anchor's immediate child folders only | FR-041 |
| D5 | On a **closed** folder it opens the folder first, then its immediate children | FR-042 |
| D6 | Every folder opened by either action has its children **loaded** — `await ensureLoaded(rel)` precedes `api.open(rel)`, exactly as `expandStep` does. **Zero folders end up marked open with unloaded children** | FR-043, SC-009 |
| D7 | Neither action expands into a folder the exclusion rules exclude. ~~`fetchChildren` filters by `isExcluded` **and the per-project `hiddenPaths`**, so an excluded folder is not in the tree to expand~~ — **see the correction below; the requirement holds, this account of why did not** | FR-044 |
| D8 | Both call `persist(selectedId)` on completion, so the resulting open state survives a project switch and a restart exactly as a manual expand or collapse does — the same `localStorage` key, the same shape | FR-045, AS-10 |
| D9 | The toolbar's Expand and Collapse all are **unchanged**, in code and in behaviour | FR-046, AS-11 |
| D10 | Expand All Children on a folder with hundreds of immediate children completes without the tree appearing to hang: loads are issued together (`Promise.all`) and the opens applied in one pass, as `expandStep` does | Edge Cases |

> **CORRECTED 2026-08-16, from implementing it.** Three statements above describe a codebase slightly
> different from the one that exists. The requirements are unchanged; what changes is where each one
> is actually enforced.
>
> ~~**D7 names the wrong filter, and following it literally would have shipped a defect.**~~
> **D7 names the wrong filter.** `fetchChildren` filters by `isExcluded(relPath, globs)` **only**. The
> per-project hidden paths are applied much later, in the `data` `useMemo` via `hiddenSet` — so
> `childrenMap`, which is exactly what `expandChildren` reads, **still contains hidden folders**.
> ~~Had the implementation trusted D7's "so an excluded folder is not in the tree to expand", *Hide in
> this project* on a folder would have been silently defeated by Expand All Children.~~ `expandChildren`
> filters `hiddenSet` explicitly. FR-044 holds; D7's account of why it holds did not.
>
> > **AMENDED 2026-08-16, from an adversarial review — the struck sentence above was WRONG, and it is
> > marked rather than deleted because it is the kind of wrong that reads as obviously true.**
> >
> > *Hide in this project* could not have been defeated. `data`'s builder
> > (`use-explorer-data.ts`, the `useMemo` at `build(dir)`) filters `hiddenSet` at **every level**, so a
> > hidden folder is dropped from its parent's children whatever its open state. `api.open('branch/secret')`
> > on a folder that is absent from `data` sets an open-map key that renders nothing, and `snapshotOpen`
> > walks `api.root` and never sees it — so it is not even persisted. **The real cost of removing the
> > `hiddenSet` filter is one wasted directory listing**, not a hidden folder appearing.
> >
> > The filter stays: issuing a `files.list` for a folder the project has hidden is work for a result
> > nothing can display, and D7's requirement is still the requirement. What changes is the reason to
> > keep it — cheap and correct, not load-bearing — and anyone who deletes it should expect no visible
> > symptom, which is precisely why the true account had to replace the dramatic one.
> >
> > **The filter is still uncovered.** `subtree-expand-collapse.e2e.ts` exercises a glob-excluded
> > `node_modules` and never a per-project hidden folder, so nothing in the suite touches `hiddenSet`
> > on this path at all. That gap is real and is NOT closed here (the review that found it fenced the
> > E2E file off to another author); the cheapest layer that reproduces it is a renderer unit test over
> > the composition `immediateChildFolders(anchorView, relPath).filter((r) => !hiddenSet.has(r))`,
> > alongside `packages/ui/tests/unit/explorer-subtree-menu.test.ts`.
>
> **D4/D5 assume a rendered view the renderer cannot produce on the tick the action runs.** The
> chevron and `expandStep` paths compute their targets from the *rendered* tree, which is safe for
> them because they only ever open folders whose parents are already rendered. `expandChildren`
> cannot: D5 requires a **closed** anchor to be opened first, and the rendered view of a closed
> folder carries no children by `expand.ts`'s own documented convention — and even after opening it,
> `data` is rebuilt by a React render that has not happened yet. So `expandChildren` names the
> anchor's children from **the listing `ensureLoaded` just returned**, wrapped in a one-level
> `ExpandNode` and handed to the same `immediateChildFolders`. Same pure function, same type, same
> decision; a different source for the one view the renderer cannot supply in time.
>
> **D9 is honoured in code, at the cost of one duplicated mapper.** `expandStep` builds its
> `ExpandNode` view with an inline mapper and `collapseChildren` needs the same mapping, but folding
> them together would edit the toolbar's path, which D9 forbids *in code* and not merely in
> behaviour. There is now a module-level `toExpandNode` beside `expandStep`'s inline copy, each
> commented to say why the duplication is deliberate. One genuinely shared change was unavoidable:
> **`ensureLoaded` now returns the listing** (`Promise<TreeNodeData[] | undefined>`), so a failed
> load is distinguishable from an empty folder and no folder can be opened on a listing that never
> arrived. It is purely additive — every existing caller ignores the return and behaves identically —
> but it is a shared function on the toolbar's path, so D9's "unchanged in code" is true of
> `expandStep` itself and not of every line it calls.
>
> > **AMENDED 2026-08-16, from an adversarial review.** Two decisions, both recorded because the code
> > alone would not explain either.
> >
> > **D1 — what "expanded" means, decided.** A descendant behind a **closed** ancestor is not
> > collapsed by this action, and `persist` still records it as open. Repro: open `a`, open `a/b`,
> > close `a`, right-click `a` → Collapse All Children — nothing happens, `a/b` stays `true` in the
> > open map and in `localStorage`, and reopening `a` shows `b` expanded. **This is intended.**
> > "Expanded" in FR-039 means expanded *and on screen*: the requirement is written for a folder the
> > user can see and act on, which is why its other half is "leave the folder **itself open**" — a
> > clause that means nothing for an anchor that was already closed. Collapsing an ancestor has
> > already achieved everything the user can observe. The recorded state beneath it is the tree's
> > MEMORY, which 026 / #197 deliberately preserves so reopening a folder restores its shape; pruning
> > it would make a collapse the user aimed at one visible folder quietly rewrite state for folders
> > they cannot see. The two halves are one mechanism — `toExpandNode` gives a closed folder
> > `children: undefined` per `expand.ts`'s convention, and `snapshotOpen` records `isOpen` regardless
> > of ancestry — and `collapseChildren` now carries this reasoning in full.
> >
> > **D9 takes a second, narrower exemption: one `.catch` on `expandStep`.** `expandStep`'s
> > `Promise.all(...).then(...)` had no rejection handler, and neither did `expandChildren`'s
> > `void (async () => …)()`. A `files.list` that REJECTS — rather than resolving with the `error`
> > `fetchChildren` already reports — escapes both as an unhandled rejection: no opens, no notice, no
> > trace, and a suite that passes straight through it. Fixing only the new copy of a shared shape
> > would leave the defect exactly where it started, so both now log via `console.error` (a raw error
> > string on screen is what the failure model forbids, and "the tree did not expand" is what the user
> > actually sees). D9's "unchanged in behaviour" holds — nothing on the success path moved — but
> > "unchanged in code" is now false of `expandStep` itself, and that is stated here rather than
> > slipped in.

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
| FR-032 (containment) | **unit** | `resolveStartDirectory` already has this coverage; ~~a case is added for a `startDirectory` outside the root~~ — see the amendment below |
| FR-034 (the substitution is announced) | **unit** | `cwd-fallback-report.test.ts`: no memory + a gone `startDirectory` reports the start directory; memory + a start directory reports the remembered one |

> **AMENDED 2026-08-16, from an adversarial review.** The FR-032 row described work that had not been
> done: `git diff origin/master...HEAD` touched neither `start-directory.test.ts` nor
> `cwd-fallback-report.test.ts`, and the only occurrences of `startDirectory` anywhere in the tests
> asserted that the string appears in persisted JSON. The cases are there now — containment for a
> `startDirectory` outside the root, for a prefix-sibling, and for one that walks out with `..`
> (`start-directory.test.ts`); the two FR-034 report cases and the honoured/escaped silences
> (`cwd-fallback-report.test.ts`); the `..` segment rule itself (`path-id.test.ts`).
>
> ~~One gap is left open and named rather than papered over: the precedence expression
> `rememberedCwd ?? startDirectory` lives in `terminal-ipc.ts`, not in core, so the unit tests mirror
> it and **cannot fail if that line is reverted**. Move `requestedCwd` into
> `packages/core/src/terminal/start-directory.ts` and have the handler call it, and the mirror can be
> deleted for the real thing.~~
>
> > **CLOSED 2026-08-16 — the gap named above was fixed the way it said.**
> > `requestedStartDirectory(rememberedCwd, startDirectory)` now lives in
> > `packages/core/src/terminal/start-directory.ts` beside `resolveStartDirectory`, is exported from
> > both barrels, and is called by `terminal-ipc.ts`. `cwd-fallback-report.test.ts` imports the real
> > function; the mirror is deleted. **Reverting the call site now fails a test instead of shipping.**
> >
> > Worth keeping the reasoning, because a two-line `??` earning a name looks like over-engineering
> > from the outside: it is not that the expression was hard, it is that **an expression cannot be
> > shared with the test that guards it**. The value has to reach both `resolveStartDirectory` and
> > `fallbackToReport` or FR-034's notice names the wrong directory — and that was already a real
> > defect on this branch once.
