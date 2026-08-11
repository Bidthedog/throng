# Contract: tab strip geometry, scrolling, and the picker

**Modules**: `packages/core/src/workspace/tab-strip.ts` (new, pure) · `packages/core/src/picker/match.ts` (new, pure) · `packages/ui/src/renderer/workspace/tab-scroll.ts`, `tab-picker.tsx`, `tab-group.tsx` · `packages/ui/src/renderer/common/picker.tsx`

**Requirements**: FR-001–FR-007, FR-019–FR-032e, FR-042–FR-046

## 1. Strip layout (FR-001–FR-007)

| # | Guarantee | Requirement |
|---|---|---|
| L1 | No native horizontal scrollbar at any tab count. The track is `overflow-x: hidden`, scrolled via `scrollLeft` | FR-001 |
| L2 | A tab's height and vertical position are **identical** overflowing and not. This is the reported defect and the primary regression test | FR-002 |
| L3 | New Tab is visible at every tab count, pinned right, vertically centred, and square | FR-003 |
| L4 | A fade shows over the leading edge of the left-most visible tab when tabs are fully hidden left, and the trailing edge of the right-most when hidden right | FR-004 |
| L5 | Fades are **overlays**: every tab's `offsetLeft` is identical with and without them | FR-005 |
| L6 | Scroll position never enters the persisted layout | FR-006 |
| L7 | Drag-to-reorder works from a scrolled position, with the indicator on the boundary under the pointer | FR-007 |

## 2. Pure geometry

```ts
export interface StripMetrics {
  tabOffsets: ReadonlyArray<{ left: number; right: number }>;
  scrollLeft: number;
  viewportWidth: number;
}

export interface StripCounts { hiddenLeft: number; hiddenRight: number; total: number; overflowing: boolean; }

/** Counts of FULLY hidden tabs each side. A partly-visible tab is neither. */
export function stripCounts(m: StripMetrics): StripCounts;

/** Target scrollLeft that puts the next tab in `direction` flush with the viewport's left edge. */
export function stepTarget(m: StripMetrics, direction: 'left' | 'right'): number | null;

/** Target that brings tab `index` into view. Returns null when it is ALREADY fully visible. */
export function revealTarget(m: StripMetrics, index: number): number | null;

/** easeInOutCubic over [0,1]. */
export function ease(t: number): number;
```

| # | Guarantee | Requirement |
|---|---|---|
| S1 | `hiddenLeft` / `hiddenRight` count only **fully** hidden tabs; `total` is every tab | FR-021 |
| S2 | Counts recompute on scroll, on tab add/destroy/reorder, and on resize | FR-022 |
| S3 | A step moves exactly one tab, landing it flush with the left edge | FR-023, FR-024 |
| S4 | `stepTarget` returns `null` when nothing is hidden that way — the control is then unavailable | FR-025 |
| S5 | `revealTarget` returns `null` for an already-fully-visible tab, so the strip does not move | FR-029a |
| S6 | Counts hold in the degenerate case of one tab wider than the viewport | spec Edge Cases |

## 3. Scrolling (FR-029–FR-031d)

| # | Guarantee | Requirement |
|---|---|---|
| A1 | The active tab is brought into view whenever it changes **by any route** — created, clicked, chord, picker, dwell-activate, layout restore | FR-029 |
| A2 | An already-fully-visible tab causes no movement | FR-029a |
| A3 | The active tab changing as a *consequence* (its predecessor destroyed) still brings the new one into view, leaving no gap | FR-029b |
| A4 | Eased in and out — accelerates from rest, decelerates to a stop. A constant-speed slide does not satisfy this | FR-030a |
| A5 | The same curve at every duration | FR-030b |
| A6 | A new scroll **supersedes** one in flight, starting from the strip's current position over the full duration | FR-030c |
| A7 | Scrolls never queue. Two quick steps move two tabs and settle **once** | FR-030d |
| A8 | A superseded scroll leaves no residue: no jump back, no drift to the old target, no late callback | FR-030e |
| A9 | The strip rests at the most recent target, recomputed against current contents — a tab destroyed mid-flight cannot be scrolled to | FR-030f |
| A10 | Duration 0 is instant: no animation, no easing | FR-031 |
| A11 | OS reduce-motion forces instant, whatever the setting says | FR-031a |
| A12 | Reduce-motion does not rewrite the stored setting | FR-031b |
| A13 | Honoured **live**; turning it on settles a scroll in flight immediately | FR-031c |
| A14 | An instant scroll still achieves the outcome: same rest position, active tab in view, counts updated | FR-031d |

**Implementation note (from R7)**: one `requestAnimationFrame` loop per strip, owning a replaceable
target. A7 and A8 are then structural — there is no second animation to leave behind and no callback
closing over a stale target.

## 4. Tab actions (FR-019–FR-032e)

| # | Guarantee | Requirement |
|---|---|---|
| T1 | The group appears **only** when the strip overflows, inside the pane, between the tabs and New Tab | FR-019 |
| T2 | Three actions: step left, step right, show all | FR-020 |
| T3 | Each shows its count: hidden-left, hidden-right, total | FR-021 |
| T4 | Each is a themed icon with a hover title naming the action | FR-032 |
| T5 | `tabs.openPicker` (`Ctrl+Alt+T`) opens the picker at **any** tab count, including when nothing overflows | FR-032a |
| T6 | The binding appears in the Key Bindings editor and is rebindable | FR-032b |
| T7 | Chord and click open the *same* picker with the same behaviour | FR-032d |
| T8 | Dismissing returns focus to where it was | FR-032e |

## 5. The picker (FR-026–FR-028g)

```ts
export interface PickerEntry { id: string; text: string; label: string; meta?: string; isCurrent?: boolean; }
export interface MatchSpan { start: number; end: number; }

/** Every whitespace-separated term must appear as a case-insensitive substring, in ANY order. */
export function matches(text: string, query: string): boolean;

/** Spans to highlight, for a text that matches. Empty when the query is empty. */
export function matchSpans(text: string, query: string): MatchSpan[];
```

| # | Guarantee | Requirement |
|---|---|---|
| K1 | Lists every tab in strip order, visible or not | FR-026 |
| K2 | Choosing scrolls the strip to that tab **and** makes it active | FR-027 |
| K3 | Typing narrows; arrows move; Enter chooses; Escape dismisses | FR-028 |
| K4 | `matches('file find.txt', 'find file')` is **true** — order-independent AND of substrings. So are `'find any file.md'` and `'prefix file any find.pdf'` | FR-028c |
| K5 | Case-insensitive | FR-028c |
| K6 | An empty or whitespace-only query matches everything | FR-028c |
| K7 | Terms match across separators, so `find file` matches `src/find/file.ts` — this is what makes the control reusable for #219's paths | FR-028c |
| K8 | Built as a **general** list-and-choose control, seeded with entries; nothing tab-specific inside it | FR-028a |
| K9 | Entries carry name and panel count, and mark the active tab | FR-028b |
| K10 | Matched terms are visibly marked in each row | FR-028e |
| K11 | Results in the seeded set's own order, never a relevance score | FR-028f |
| K12 | No match keeps the picker open and says so | FR-028g |

## 6. Per-tab presentation (FR-042–FR-046)

| # | Guarantee | Requirement |
|---|---|---|
| P1 | Panel count renders as a pill; no `[3]` square-bracket form remains | FR-042 |
| P2 | Hover shows name, panel count, and each panel's name one per line | FR-043 |
| P3 | Close affordance runs the existing Destroy Tab action, same confirmations and side effects | FR-044 |
| P4 | Visible on the active tab always, and on the tab under the pointer. **Not** permanently on every tab | FR-044a |
| P5 | Its space is reserved on every tab: width and label position identical shown and hidden | FR-044b |
| P6 | A hover-revealed affordance is **inert** for the arming delay | FR-044c |
| P7 | The delay restarts on each appearance, never accumulates, and a click inside it is **ignored, not queued** | FR-044d |
| P8 | Such a click also does not activate the tab or start a rename | FR-044e, FR-045 |
| P9 | The **active** tab's always-present affordance has no arming delay | FR-044g |
| P10 | Unavailable wherever Destroy Tab is unavailable | FR-046 |

## Test obligations

**Unit**: everything in §2 and §5's `matches`/`matchSpans`, including K4's three worked examples
verbatim from the spec, K6, K7, and S4/S5's `null` cases.

**E2E**: L1–L7 (L2 and L5 by measuring `getBoundingClientRect` before and after overflow), A1–A3,
A6–A14, T1–T8, K1–K3, K9–K12, P1–P10. Register every new spec in `shard-plan.json`; the picker and
settings specs also belong in `parallel-plan.json`'s serial tier, since they steal focus.
