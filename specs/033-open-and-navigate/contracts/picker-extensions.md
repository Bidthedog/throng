# Contract: extending the shared picker

**Modules**: `packages/ui/src/renderer/common/picker.tsx` (extended) · `packages/core/src/picker/match.ts` (extended) · `packages/core/src/picker/rank.ts` (new, pure)

**Requirements**: FR-004, FR-007, FR-007a, FR-007b, FR-010–FR-010b, FR-014, FR-060 · SC-013

The governing constraint is negative and it is worth stating before the additions: **a caller that
passes none of these props must behave exactly as it does today.** `tab-picker.tsx` passes none.

## 1. Core — compiled matching

```ts
// packages/core/src/picker/match.ts  (extended; matches / matchSpans become wrappers)
export interface CompiledQuery {
  /** True for an empty or whitespace-only query — which matches everything (K6). */
  readonly empty: boolean;
  test(text: string): boolean;
  spans(text: string): MatchSpan[];
}
export function compileQuery(query: string): CompiledQuery;
```

| # | Guarantee | Requirement |
|---|---|---|
| C1 | `matches(t, q) === compileQuery(q).test(t)` and `matchSpans(t, q)` deep-equals `compileQuery(q).spans(t)`, for every input. **The existing `picker-match.test.ts` passes unmodified** — that is the evidence the refactor changed nothing | FR-004 |
| C2 | A query's regular expressions are built **once**, not once per entry. At 50,000 entries and two terms this is 2 constructions rather than 100,000 | SC-002 (R3) |
| C3 | The case-folding rule is unchanged and still stated once: an `i`-flagged `RegExp`, never `toLowerCase()`, because folding can change a string's length and misalign the spans | 031 |

## 2. Core — ranking

```ts
// packages/core/src/picker/rank.ts  (new, pure)
/** Higher is better. Corpus-agnostic in signature; file-path-shaped in this implementation. */
export function rankFilePath(text: string, query: CompiledQuery): number;

/** Sort by score DESCENDING, then by the item's seeded index ASCENDING. */
export function rankStable<T>(items: readonly T[], score: (item: T) => number): T[];
```

| # | Guarantee | Requirement |
|---|---|---|
| K1 | A term hit inside the **file name** (the segment after the last `/`) outranks a hit only in the directory part | FR-007a |
| K2 | Among hits of the same kind, an **earlier** hit outranks a later one | FR-007a |
| K3 | Entries the score cannot separate keep the order they were **seeded** in. The tiebreak is the explicit index, not the sort's stability | FR-007a |
| K4 | The result is a pure function of `(items, query)` — the same inputs always give the same order | FR-007b |
| K5 | An empty query scores every entry equally, so the list is the seeded order in full | K6 (031) |
| K6 | `rankStable` returns a new array and does not mutate its input | — |

## 3. Renderer — the five new props, and two widened

*(Corrected 2026-08-15, baseline finding F8. This heading has said "four" and then "five"; the
truthful count is **five added and one widened**, which is why neither number was ever right.
Corrected again 2026-08-16: Phase 8 widened a second existing member, `onChoose`, so it is now
**five added and two widened** — and the pattern of this heading being wrong is itself the argument
for counting the widenings rather than only the additions.)*

> **CORRECTED AGAIN 2026-08-16 — there are now SIX added.** `notice?: ReactNode` was added while
> delivering FR-069d, and the reason is worth more than the count. `emptyMessage` renders only when
> the list is empty, and D2's flash fix made the list *never* empty during a toggle flip — so the
> "still listing" line it was carrying could no longer appear at all. Widening `emptyMessage` to draw
> alongside rows was **rejected**: it would put *"No tabs match"* over a populated tab list, breaking
> SC-013 and the K12 meaning of that member. `notice` is a separate always-visible slot instead,
> rendered **outside** `.picker__list` (which is `overflow-y: auto`, so a notice inside it scrolls off
> under arrow-down while the rows it qualifies stay on screen), carrying
> `data-testid="${testId}-notice"` and `aria-live="polite"`.
>
> Its one ordering rule: **`notice` outranks `emptyMessage`** when both would apply. "No files match"
> is a claim about a finished set, and the only reason a notice is up is that the set is not finished.
> `null` reads the same as omitting it, so a caller returning `null` for "nothing to say" cannot blank
> the picker. With `notice` absent the list branch reduces to the exact expression it replaced, so
> `tab-picker.tsx`'s rendered DOM is bit-for-bit unchanged.

`PickerProps` gains six optional members — `rank`, `maxRows`, `truncatedMessage`, `header`,
`initialQuery`, `notice` — and **two existing members widen**: `emptyMessage` from `string` to `ReactNode`,
and `onChoose` from `(entry) => void` to `(entry, query) => void`. Those widenings are why "the N
new props" undercounts the surface: a caller passing a string or ignoring a second argument is
unaffected, so `tab-picker.tsx` stays untouched and SC-013 holds, but the type a future caller may
rely on is not the type this contract originally declared.

```ts
export interface PickerProps {
  // …existing: title, entries, onDismiss, placeholder, testId
  /**
   * WIDENED (2026-08-16, Phase 8): was `onChoose: (entry: PickerEntry) => void`.
   *
   * FR-058 remembers the query that OPENED A FILE, and only that one — so the accepted query has to
   * reach the caller at the moment of acceptance. The picker owns the query text; the caller owns
   * the decision. Passing it back on choose is what lets Quick Open record an ACCEPTED value
   * without either side reaching into the other, and it is why dismissal cannot record anything:
   * there is no path to this callback that is not an acceptance. INERT for every existing caller —
   * an extra argument to a function that declares one parameter is ignored by both TypeScript and
   * JavaScript, so `tab-picker.tsx` is untouched and SC-013 holds. Recorded for the same reason as
   * `emptyMessage` below: it is a change to an EXISTING member of a published type.
   */
  onChoose: (entry: PickerEntry, query: string) => void;
  /**
   * WIDENED (2026-08-15, F8): was `emptyMessage?: string`.
   *
   * Quick Open's FR-015 "still listing this project's files…" state is drawn through this slot and
   * has to carry `data-testid="quickopen-building"`, which a bare string cannot. INERT for every
   * caller passing a string — a `string` IS a `ReactNode`, so no existing call site changes shape,
   * no runtime behaviour changes, and `tab-picker.tsx` (which passes one) is untouched: that is why
   * SC-013 still holds. It is recorded all the same because it is a change to an EXISTING member
   * of a published type — the surface a future caller may rely on is no longer the surface this
   * contract originally declared, and "inert today" is not "unchanged".
   */
  emptyMessage?: ReactNode;
  /** Ranks the FILTERED entries. Absent → seeded order, unchanged (K11). */
  rank?: (text: string, query: CompiledQuery) => number;
  /** Most rows to RENDER. Absent → no cap. */
  maxRows?: number;
  /** Rendered when `maxRows` truncated the list. Absent → nothing is said. */
  truncatedMessage?: (shown: number, total: number) => string;
  /** Rendered ABOVE the input, first in the DOM and first in the tab order. */
  header?: ReactNode;
  /** Seeds the query, fully selected on open. Absent → empty, as today. */
  initialQuery?: string;
}
```

The pipeline, in order, and the order matters:

```
entries → filter(compiled.test)  → rank (only when `rank` is given) → slice(maxRows) → render
```

| # | Guarantee | Requirement |
|---|---|---|
| P1 | With `rank` absent, the visible list is `entries.filter(...)` — the same expression, the same array order, and K11's comment still describes the code | SC-013 |
| P2 | Ranking is applied **after** filtering and **before** the cap, so the cap keeps the best 200 rather than the first 200 | FR-007a, FR-014 |
| P3 | The cap limits **rendering only**. Every candidate is still matched, so the truncation count is the truth about how many matched | FR-014 |
| P4 | When `visible.length < matched.length`, `truncatedMessage(shown, total)` is rendered in the list, with `data-testid="<testId>-truncated"` | FR-014 |
| P5 | `initialQuery` seeds the input and the input's text is **fully selected** on open, so the first keystroke replaces it | FR-060 |
| P6 | With `initialQuery` set, the list shows that query's **results**, not an empty list | FR-060 |
| P7 | `header` renders above the input inside the dialog card. It is inside the focus trap, so Tab cannot leave the modal through it | FR-010 |
| P8 | Focus lands in the **query input** on open, never on the header | FR-010a |

## 4. Key handling — the one behavioural change to an existing path

Today `onKeyDown` sits on the dialog element and claims `Enter` wherever it originated. FR-010b requires
Enter on the header's control to change that control and open nothing.

| # | Guarantee | Requirement |
|---|---|---|
| E1 | `Enter`, `ArrowUp` and `ArrowDown` are claimed **only** when the event's target is the query input. Otherwise they fall through to the focus trap and to the focused control's own handler | FR-010b |
| E2 | `Escape` is claimed from anywhere inside the modal and always dismisses | FR-012, FR-065 |
| E3 | `Tab` continues to reach `trap.onKeyDown` from every element | 031 |
| E4 | With no `header`, E1 is unobservable: the input is the only focusable element, so every key already originates there. **The tab picker sees no change** | SC-013 |
| E5 | Shift+Tab from the input moves to the header's control — as the previous focusable in DOM order, the trap's focusable set being built by `querySelectorAll` | FR-010a (R2) |

## 5. Quick Open's seeding, in full

| Prop | Value |
|---|---|
| `title` | `'Quick Open'` |
| `testId` | `'quickopen'` — one word, matching `tabpicker`'s precedent and keeping `[data-testid^="quick-"]` selectors free |
| `entries` | one per indexed path; `id`/`text`/`label` all the root-relative POSIX path |
| `rank` | `rankFilePath` |
| `maxRows` | `QUICK_OPEN_MAX_ROWS` (200), exported from `@throng/core` |
| `truncatedMessage` | `(shown, total) => \`Showing ${shown} of ${total} matches\`` |
| `header` | the target control — **only** when invoked from inside an editor panel (FR-011) |
| `initialQuery` | the remembered query — only when its setting is on and a value is held (FR-057, FR-060) |
| `emptyMessage` | `'No files match'` (FR-006 of 031's K12: the modal stays open and says so) |
| `placeholder` | `'Type part of a file path…'` |

## 6. The target control

`packages/ui/src/renderer/navigate/quick-open-target.tsx`, rendered into `header`.

| # | Guarantee | Requirement |
|---|---|---|
| T1 | Two options: **the currently active editor** and **a new editor panel in this tab** | FR-010 |
| T2 | Preselected from `editor.openTarget` — `'lastActive'` → the active editor, `'new'` → a new panel | FR-010 |
| T3 | Drawn **only** when the modal was invoked from inside an editor panel. Absent otherwise, and the choice then follows `editor.openTarget` | FR-011 |
| T4 | **Space or Enter** changes its value while it holds focus, and opens nothing | FR-010a, FR-010b |
| T5 | Choosing "the currently active editor" performs the **Last-Active-Editor route** — `openFileInTab(ws, tabId, absPath, 'lastActive')` — not a parallel implementation of it | FR-010, SC-004 |
| T6 | It is a themeable control with a hover title naming what it does; it is not a dialog decision button, so the icon rule applies | Themeable icon controls |

> **SUPERSEDED 2026-08-15 by FR-068 (plan D5); recorded 2026-08-16.** The table above describes the
> control as first shipped — an icon-only toggle whose alternative was named in the hover title and
> nowhere else. Hand-testing found that a user could not see where a file would land without hovering,
> and FR-068 replaced it with a **single icon-plus-text button** reading *"Will open in a **new
> editor**"* or *"Will open in the **active editor** (*panel name*)"*, icon and text one target.
>
> What that changes here: **T6's "hover title naming what it does" is no longer the mechanism** — the
> title remains, but the destination is now stated in visible text, which is what SC-020 asserts.
> **T1's "two options"** describes a control that shows both; the shipped one names its current
> destination and switches. That difference was itself a converge finding (T112), settled in
> `spec.md` by marking FR-010 superseded by FR-068 rather than by changing the code.
> **T2, T3, T4 and T5 are unaffected** — the preselection, the invoked-from-an-editor condition, the
> Space/Enter behaviour and the Last-Active-Editor route all survived the rewrite unchanged, which is
> why this is a supersession of the presentation only.


## Test identifiers fixed after §5 (2026-08-15)

§5 fixed `quickopen`. Writing the E2E specs required three more, and they are recorded here rather
than left to the implementation, because a spec and an implementation that disagree about a
`data-testid` produce a test that stays red **for the wrong reason** — which looks identical to a
feature that is not finished.

*(Corrected 2026-08-15, closing baseline finding F8's second half. This paragraph said "§5 fixed
`quickopen` and `quickopen-truncated`" and then promised **three more** above a table of **two** —
so the count was wrong and the attribution was wrong in the same sentence. `quickopen-truncated` was
never fixed by §5: it is derived by **P4**, from `testId` plus the `-truncated` suffix, which is why
it appeared in neither list and went uncounted. It is the third row below, and the table now matches
the number in front of it.)*

| Identifier | On | Notes |
|---|---|---|
| `quickopen-target` | the two-option target control (FR-010) | carries `data-value="lastActive" \| "new"` |
| `quickopen-building` | the "still listing" state (FR-015, S3) | rendered through the widened `emptyMessage` (§3) — the reason that member is a `ReactNode`. Present only while enumeration is in flight |
| `quickopen-truncated` | the truncation notice (FR-014) | **derived, not literal** — P4 renders `<testId>-truncated`, so it follows from `testId` being `quickopen` and is not spelled anywhere in §5 |

**`data-value` deliberately reuses `editor.openTarget`'s own vocabulary** (`lastActive` / `new`)
rather than inventing a second spelling. The preselection assertion is then a comparison against the
setting, not a translation of it — and a translation layer between a setting and the control it
preselects is where the two silently drift apart.
