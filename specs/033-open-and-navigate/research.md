# Research: Open and navigate

**Feature**: 033 | **Date**: 2026-08-15 | **Constitution**: v4.7.0

Phase 0 output. Every unknown in the plan's Technical Context is resolved here, with the alternative
that was rejected and why. Nothing below is a preference — each is a claim about *this* repository that
the cited file can be checked against.

---

## R1. Which process owns the project file index

**Decision**: **UI-main** (the Electron main process), as a root-keyed, ref-counted registry in
`packages/ui/src/main/project-file-index.ts`. The renderer holds the candidate array it was pushed; the
daemon is not involved.

**This is the single largest design decision in the feature**, so the reasoning is given in full.

**Rationale — the renderer is disqualified by rule.** It is sandboxed and reaches the filesystem only
through the `throng:files:*` channels (`packages/ui/src/main/files-ipc.ts`); there is no `node:fs` in
`packages/ui/src/renderer` and `use-explorer-data.ts` obtains every directory listing over IPC. Beyond
the rule, a 50,000-entry walk on the renderer's single thread is precisely the stall FR-015 forbids.

**Rationale — the daemon is disqualified by scope and lifetime, not by capability.** It could do it; it
should not.

| | UI-main | Daemon |
|---|---|---|
| Already walks/watches a project root | `NodeFileSystem`, `NodeFileWatcher`, `ExplorerWatcher`, `FilesService` | **Nothing.** Grep for `readdir`/`opendir` in `packages/daemon` returns nothing |
| Knows the exclusion globs | Yes — `settings.explorer.excludeGlobs` via `FileConfigStore` | Reads `settings.json` once at startup and never reloads (`composition-root.ts`) |
| Hops to the renderer | One (`webContents.send`) | Three (renderer → main → named pipe → daemon) |
| Serves a per-window root (FR-017) | Natural — it owns the windows | Would need window identity pushed across the pipe |
| Value of outliving the UI | None — the index is a **cache of the filesystem**, stale the moment the UI is gone | The daemon's whole purpose |

The last row settles it. The daemon exists so terminals survive the UI closing. An index that survived
the UI closing would have to be revalidated against the filesystem on reconnect anyway, which is the
same walk — so the daemon buys nothing and costs a new RPC surface, a second copy of the exclusion
rules, and a second answer to "which root".

**Rationale — UI-main is where the filesystem already is.** Putting the index anywhere else would make
that other place the second module in throng that walks a project root and applies its ignore rules,
which is the DRY violation Principle VIII names directly.

**Shape**: one `RootIndex` per **absolute root**, ref-counted by subscribing `webContents` id. The main
window and a sub-workspace showing panels from the same project therefore share one walk and one watch;
a sub-workspace on a different root gets its own. The last unsubscribe disposes the watch and drops the
array.

**Alternatives rejected**:

- *A daemon RPC with SQLite persistence.* Persisting the index makes it a second source of truth about
  the filesystem which is wrong from the first external change; the migration and the drift guard would
  be pure cost.
- *Enumerate lazily on first Quick Open.* FR-013 requires the set to be prepared **before** the user
  types, and FR-015 requires the app to stay usable while it is prepared. Starting the walk when the
  project opens is what makes both true; opening the modal only subscribes.
- *Compute matches in main and send the top 200 per keystroke.* Tempting, and it would move the cost off
  the renderer entirely — but FR-004 requires the **shared picker**, whose filtering and highlighting
  are renderer-side (`picker.tsx` L136-140). Forking that is exactly what FR-004 forbids.

---

## R2. What the shared picker needs, and what must not change

**Decision**: four optional props and one key-handling refinement, all opt-in, so a caller that passes
nothing behaves exactly as it does today.

```ts
rank?: (text: string, query: CompiledQuery) => number;   // absent → seeded order (K11 holds)
maxRows?: number;                                        // absent → no cap
truncatedMessage?: (shown: number, total: number) => string;
header?: ReactNode;                                      // rendered ABOVE the input
initialQuery?: string;                                   // seeded and fully selected on open
```

**Rationale**: `picker.tsx` carries a comment on the filter line — *"`filter` preserves the seeded order
— K11 is this line, and it must stay this line."* It does. The ranking is applied **after** it, only
when `rank` is supplied, so SC-013's "the tab picker's order is byte-identical" is a property of the
type rather than of a test: `tab-picker.tsx` passes no ranker, so `ordered === filtered` by reference.

**The key-handling refinement is not cosmetic.** Today `onKeyDown` sits on the dialog container and
claims `Enter` for "choose the highlighted row" wherever it originates. FR-010b requires Enter on the
target control to change that control and open nothing. So `Enter`, `ArrowUp` and `ArrowDown` are
claimed only when the event's target **is the query input**; everything else falls through to the focus
trap and thence to the control's own handler. `Escape` keeps claiming from anywhere — dismissal must
work wherever focus is.

**The header's position in the tab order is where the spec and the DOM disagree, harmlessly.** FR-010a
says the control "is last in the modal's tab order, so a backwards step reaches it". The header is
rendered **first** in the DOM, above the input, which is both the accessible order and the visual one;
`useFocusTrap` builds its focusable set with `querySelectorAll`, i.e. in DOM order, so Shift+Tab from
the input reaches the control as the **previous** focusable rather than by wrapping to the last. The
observable requirement — Shift+Tab moves focus to the control — is satisfied either way, and the
alternative (an explicit `tabIndex` arrangement putting a visually-first control last) is the kind of
mismatch between reading order and tab order that assistive technology reports as a defect.

**Alternatives rejected**:

- *A separate `FilePicker` component.* FR-004 forbids a second list widget, and the reason is 031's:
  every behaviour the picker already proves (no-match stays open, highlight movement, focus return,
  scrim rules) would have to be re-proved.
- *Sorting the entries before passing them in.* FR-007a rejects this explicitly, and it is right to: the
  control would then re-filter a pre-sorted list on every keystroke and the ranking would be computed
  against the unfiltered corpus.

---

## R3. Why 50,000 entries cannot go through `matches()` as it is written

**Decision**: add `compileQuery(query): CompiledQuery` to `packages/core/src/picker/match.ts` and make
`matches` / `matchSpans` one-line wrappers over it. No behaviour changes.

**Rationale**: this is measurement, not taste. `matches` calls `findFolded` per term, and `findFolded`
does `new RegExp(term.replace(REGEX_SPECIAL, '\\$&'), 'i').exec(text)` — it **constructs a regular
expression per term per entry**. At 50,000 entries and a two-term query that is 100,000 `RegExp`
constructions per keystroke, before any matching happens. Compiling once per query and reusing the
compiled matcher across the corpus reduces that to two.

The wrapper form is what keeps it DRY: the folding rule (`i` flag rather than `toLowerCase()`, because
lower-casing can change a string's length and misalign the spans) stays stated once, and every existing
caller and every existing test in `packages/core/tests/unit/picker-match.test.ts` continues to pass
unmodified — which is the evidence that the refactor changed nothing.

**Alternative rejected**: *leave `matches` alone and cap the corpus.* The cap is on **rendered rows**
(FR-014), not on candidates — a query must be matched against every file or FR-014's truncation notice
would be a lie about which files exist.

---

## R4. Compiling the exclusion globs once

**Decision**: add `compileExcluder(globs): (relPath: string) => boolean` to
`packages/core/src/explorer/exclude.ts`; `isExcluded` becomes `compileExcluder(globs)(relPath)`.

**Rationale**: the same defect as R3, in the other hot loop. `isExcluded` calls
`picomatch(globs, { dot: true })` on **every invocation**, so today's per-directory use pays one
compilation per directory and a 50,000-file walk would pay 50,000. The walk compiles once and carries
the predicate.

This also gives `walkFiles` its exclusion parameter as a **function** rather than a glob array, which is
what keeps `packages/core/src/explorer/file-index.ts` free of picomatch and therefore trivially
unit-testable with a hand-written predicate.

**Alternative rejected**: *memoise inside `isExcluded`.* A module-level cache keyed on the glob array is
a hidden singleton — Principle IX territory — and it would still be looked up 50,000 times.

---

## R5. How the index stays current, and why it takes two mechanisms

**Decision**: **both** a targeted rescan and a trailing full reconcile, each with its own ceiling.

1. On each `IFileWatcher` change signal, rescan **the directory the change was reported in** and diff.
   This is the fast path and it is what satisfies SC-005's two seconds for the ordinary case.
2. Schedule a **full re-walk** to reconcile, debounced by a quiet period and — critically — bounded by
   its own maximum wait, so sustained churn cannot postpone it forever.

**Rationale**: `NodeFileWatcher` reports **one coalesced path per burst** (`onChange(lastPath)`), and
`ExplorerWatcher` narrows that to one `{ relDir }`. That is enough to repair one directory and not
enough to repair a `git checkout` that touched fifty. The tree lives with that because a stale row is
visible; a stale search index is not, and FR-016 says "created, deleted, renamed or moved — by any
actor".

The ceiling on the reconcile is not defensive programming, it is the lesson `NodeFileWatcher` already
carries in a twenty-line comment: a debounce with only a quiet period *never fires* under sustained
churn — measured at 180 events over 3 s producing **zero** reports (#186). A reconcile scheduled the
same way would have the same bug, in a component whose staleness nobody can see.

**Alternatives rejected**:

- *Full re-walk on every signal.* During a build the watcher's own `maxWaitMs` ceiling produces a signal
  roughly every second; a 50,000-entry walk per second pegs a core to repair a directory that was
  already repaired.
- *Targeted rescan only.* Correct for a single change, silently wrong after any burst — and "silently"
  is the whole problem.
- *Rebuild when Quick Open opens.* FR-013 and FR-015 both forbid it: the walk would be on the path
  between the chord and the first keystroke.

---

## R6. What "this window's own root" means (FR-017)

**Decision**: the root is the **active panel's origin project's `rootFolder`**, and `null` when the
active panel is owned by the sub-workspace itself. With `null`, Quick Open does not open (FR-018).

**Rationale**: a sub-workspace window has no project of its own — it mounts no explorer, and
`packages/ui/src/renderer/workspace/panel-body.tsx` already resolves a root **per panel**:

```ts
const ownedBySub = subWin !== null && originProject === undefined;
const root = ownedBySub ? null : (originProject?.rootFolder ?? activeProject?.rootFolder ?? null);
```

FR-017 says "that window's own root", which presumes one; Principle XI explicitly permits a
sub-workspace to hold panels from **multiple** projects, so the presumption does not always hold. Rather
than invent a second rule, this feature reuses the one the codebase already applies to decide which root
an editor or terminal in that window belongs to. **This is a spec-silent case decided here**, not a
requirement being reinterpreted.

**Alternative rejected**: *fall back to the main window's active project.* That is precisely what
`panel-body.tsx` refuses to do, and for the same reason — it would offer a user files from a project
they are not looking at, in a window Principle I says must not mix contexts by accident.

---

## R7. What crosses IPC, and how often

**Decision**: a **snapshot on subscribe, deltas thereafter**, on new `throng:fileIndex:*` channels.

| Channel | Direction | Payload |
|---|---|---|
| `throng:fileIndex:subscribe` | invoke | `{ root }` → `{ status: 'building' \| 'ready', paths?: string[] }` |
| `throng:fileIndex:unsubscribe` | send | `{ root }` |
| `throng:fileIndex:update` | push, per-window | `{ root, status, paths?, added?, removed? }` |

**Rationale**: 50,000 root-relative POSIX paths are roughly 2 MB of strings. Sending that once when the
modal first opens is a structured clone of a few tens of milliseconds and is invisible. Sending it every
time a file changes is not — hence the delta, computed in main by `diffPaths(previous, next)` against
the snapshot it last sent. A `git checkout` produces a delta of hundreds; a build produces a delta of
tens; quiescence produces nothing at all, because a reconcile that finds no difference sends no message.

The channels are new rather than added to `files.*` because `throng:files:setRoot` sets one
process-wide root (see the plan's Complexity Tracking) and the index is deliberately keyed by root.

**Alternative rejected**: *re-send the whole snapshot on every change.* 2 MB per second during a build,
to deliver information the renderer already has.

---

## R8. Where the Quick Open ranking rule lives, and how it stays deterministic

**Decision**: `packages/core/src/picker/rank.ts`, pure, two exports:

```ts
export function rankFilePath(text: string, query: CompiledQuery): number;
export function rankStable<T>(items: readonly T[], score: (item: T) => number): T[];
```

`rankFilePath` scores a root-relative path: a term hit inside the **file name** (after the last `/`)
outranks a hit only in the directory part, and an earlier hit outranks a later one. `rankStable`
decorates with the **seeded index** and sorts by `score` descending, `index` ascending.

**Rationale**: FR-007a demands that entries the ranking cannot separate "fall back to the order they
were seeded in, so the outcome is deterministic rather than dependent on a sort's stability". `Array.
prototype.sort` **is** stable in every engine throng ships on — and the requirement is right anyway,
because relying on that makes the guarantee a property of V8 rather than of the code. The explicit index
tiebreak is one line and it makes FR-007b (the order changes only when the query changes) provable by
inspection.

**Alternative rejected**: *a fuzzy/subsequence score.* 031 chose an order-independent AND-of-substrings
filter because it is the rule a user can predict; a fuzzy score would rank by a rule nobody can predict
and would make the highlight spans (`matchSpans`) inconsistent with the ordering.

---

## R9. Where the Go To Line clamp lives, and why the gutter is accurate for free

**Decision**: `packages/core/src/editor/goto-line.ts` —
`resolveGotoLine(raw: string, lineCount: number): number | null`. `null` for empty, whitespace or
non-numeric input (FR-023); otherwise clamped into `[1, lineCount]` (FR-022).

**Rationale**: the whole of FR-021–FR-023 is arithmetic over a string and a count, so it belongs in the
fast layer, and the three edge cases the spec enumerates (0, negative, beyond the end, empty document)
become unit tests rather than E2E scenarios.

**Gutter accuracy is structural, not arranged.** `use-editor.ts` mounts a bare `lineNumbers()` with no
options, so the gutter draws CodeMirror's own **logical** line numbers; `view.state.doc.line(n)` is the
same logical line, wrapped or not. SC-006 is therefore satisfied by construction — which is exactly why
SC-006 insists on asserting the **rendered** gutter number rather than a document offset: the assertion
exists to catch a future change that breaks the identity, not to establish it.

**Alternative rejected**: *`@codemirror/search`'s `gotoLine` panel.* FR-028 forbids a second, competing
go-to-line surface, and it would arrive with its own key binding and its own dialog chrome.

---

## R10. Where Go To Line's focus goes, and why it is not the picker's rule

**Decision**: Go To Line returns focus by calling `getEditorView(panelId)?.focus()` explicitly, **not**
by restoring `document.activeElement` as `picker.tsx` does.

**Rationale**: the two requirements pull in opposite directions and the difference is easy to miss.
`picker.tsx` captures `document.activeElement` during render and restores it on unmount — correct for a
window-level detour. But FR-026 says that if a find bar was open **and focused** when Go To Line was
invoked, dismissing or confirming returns focus to the **editor**, not to the find bar. Restoring the
captured element would return it to the find bar's input, quietly violating FR-026 while looking
correct.

FR-026a is satisfied by omission, and the plan states it as a prohibition rather than a behaviour:
**nothing in `packages/ui/src/renderer/navigate/` may import from `search/search-store.ts`.** The find
bar closes through `closeFind()` and through `closeFindIfNotOn(activePanelId)` — an effect keyed on the
**active panel** — so the other half of the rule is that the navigation modals must never change the
active panel. Neither does.

---

## R11. The 200-row cap, the 50,000-file target, and Principle X

**Decision**: `QUICK_OPEN_MAX_ROWS = 200` is an exported constant in `@throng/core`, passed to the
picker as the `maxRows` prop. The index's timings (`quietMs`, `reconcileMaxWaitMs`) are **constructor
options** on `ProjectFileIndexService` with documented defaults. Neither becomes a user setting.

**Rationale**: Principle X forbids limits hardcoded *in business logic* and requires them abstracted
into settings **injected** rather than read ad hoc. A named constant consumed as a prop, and options
supplied at the composition root, are the two forms this repository already uses for exactly this class
of value — `NodeFileWatcher`'s `debounceMs` / `maxWaitMs` / `maxRetries`, `STORM_CHECK_EVERY`,
`DEFAULT_SUBMENU_DELAY_MS`, `ROW_HEIGHT`. None of those is a preference, and none is a magic number
buried at its point of use.

**Alternative rejected**: *make the cap a user setting.* FR-058 authorises exactly two new settings, and
a third would arrive needing a `FieldDescriptor`, a slider whose step passes `slider-descriptors.test.ts`
(≥1% of range), a default, a bound, and a place in the Settings form — for a number no user has asked to
change. YAGNI, and scope the spec did not grant.

---

## R12. How #244 is closed so that it stays closed

**Decision**: three things, because the requirement has two halves and only one of them is a test.

1. **Replace the predicate.** `menu-keyboard.e2e.ts:91` becomes the corrected form already used at
   `menu-keyboard.e2e.ts:127` and, with its reasoning written out, at `notice-stacking.e2e.ts:36-87`:
   assert `document.activeElement?.closest('[data-testid="file-explorer-tree"]') != null` **and** that
   the specific row carries `tree-row--selected`. The repository has already solved this; the fix is to
   apply the solution to the one site that still predates it.
2. **Stop it coming back.** A new unit test, `packages/ui/tests/unit/focus-guards.test.ts`, scans every
   file under `packages/ui/tests/e2e/` for the `activeElement?.textContent … includes(` shape and fails,
   naming file and line. This is the pattern `icon-call-sites.test.ts`, `no-inline-artwork.test.ts` and
   `shard-plan.test.ts` already establish: a source-scanning unit test is how this codebase makes a
   convention enforceable.
3. **Demonstrate the failure once, by hand, and record it.** FR-053b requires the replacement to be
   *shown* failing when its precondition is removed. A test that asserts another test fails cannot live
   in the suite — it would need a mutated checkout and a nested Playwright run. So the mutation
   (delete the `row.click()`; observe the red) is a step in [quickstart.md](./quickstart.md) and its
   output is pasted into the PR. **This is stated as a manual proof rather than dressed up as
   automation**, which is the same honesty the requirement was written to demand.

**Rationale for why grep alone is not enough**: the shape is one instance of a class. The durable
protection is (1) — a guard that asserts the state the keystroke actually depends on — and (2) only
stops the *known* vacuous form spreading again, which is precisely how this one spread (it was copied as
precedent into #239 and PR #242).

**Alternative rejected**: *delete the polling and use a fixed wait.* That is the "sleep wearing a
condition's clothes" FR-053b names, and it would reintroduce the load-sensitivity the poll was added to
fix.
