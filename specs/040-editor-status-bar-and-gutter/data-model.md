# Phase 1 Data Model: Editor Status Bar Readouts and Gutter Visibility

**Feature**: 040 | **Date**: 2026-08-25 | **Plan**: [plan.md](./plan.md)

This feature persists three booleans and nothing else. Everything below them is derived state that
lives for as long as a view does.

---

## 1. Persisted settings

Three new keys in `packages/core/src/config/app-settings.ts`, each with a descriptor in
`settings-metadata.ts` (FR-050; the completeness test fails the build otherwise).

| Key | Type | Default | Group | Subgroup | Governs |
|---|---|---|---|---|---|
| `editor.statusBar.showCursorPosition` | boolean | `true` | Editor | Status Bar | caret line + column (FR-030) |
| `editor.statusBar.showCounts` | boolean | `true` | Editor | Status Bar | selected chars, total chars, total words — as one (FR-031) |
| `editor.showGutter` | boolean | `true` | Editor | *(none)* | the line-number gutter (FR-040) |

**Existing key, changed only in metadata** — no key rename, no default change (FR-039):

| Key | What changes | Requirement |
|---|---|---|
| `editor.showStatusBar` | `description` rewritten to name the full contents and state that hiding overrides the per-readout settings; gains `subgroup: 'Status Bar'` | FR-034, FR-037 |

**Untouched, and deliberately**: `terminals.showStatusBar` keeps `group: 'Terminal'` and gains no
subgroup (FR-038).

**Backwards compatibility**: a `settings.json` written before this feature has none of the three keys
and loads with every value it does have intact, the new keys taking their defaults (FR-051). Nothing
migrates, because nothing was renamed.

---

## 2. `FieldDescriptor.subgroup`

One optional field added to the shared descriptor shape in `packages/core/src/config/metadata.ts`.

```ts
export interface FieldDescriptor {
  key: string;
  label: string;
  description: string;
  /** labelled section the field is grouped into (FR-026/030/038). */
  group: string;
  /**
   * Optional second level inside `group` (040, FR-035). A descriptor without one renders exactly
   * as it does today — flat under its group heading, above any subsection.
   */
  subgroup?: string;
  control: ControlKind;
  // …unchanged…
}
```

**Invariants** the renderers rely on, and which a unit test asserts:

- A descriptor with **no** `subgroup` renders flat under its group, and **before** any subsection
  (FR-036b).
- Subsections appear in **declaration order**, the same rule groups already follow (FR-036a).
- A subgroup is only meaningful inside a group; a `subgroup` with no `group` is not representable
  because `group` is required.
- Adding the field changes **no** control type, so 007 FR-028's exhaustive *control vocabulary* is
  untouched — this is a descriptor field, not a `ControlKind`. (#79 is therefore not affected.)

---

## 3. Derived state — two stores, two key scopes

The scope split is a Principle XI requirement, not a convenience ([research.md D5](./research.md)).

### 3.1 Caret position — keyed by **panel**

```ts
/** Where this PANEL's caret is. View state: two panels on one document have two carets (FR-006). */
interface CaretPosition {
  /** 1-based (FR-002). */
  line: number;
  /**
   * 1-based CHARACTER offset within the line (FR-002a).
   * A tab advances this by exactly 1. NOT a display column — it must not depend on indent width.
   */
  column: number;
}
```

Keyed by `panelId`. Written synchronously from the editor's update listener whenever
`update.docChanged || update.selectionSet`. Dropped when the panel unmounts.

### 3.2 Document metrics — keyed by **document**

```ts
/** What the DOCUMENT contains. Every panel showing it must agree (FR-007). */
interface DocumentMetrics {
  /** Characters, INCLUDING line breaks at one each (FR-003a). Unchanged by an LF <-> CRLF conversion. */
  totalCharacters: number;
  /** Runs of non-whitespace (FR-003b). `foo_bar()` is one word. */
  totalWords: number;
}
```

Keyed by the document identity the existing replica layer already uses. Written **debounced at
200 ms** (FR-008b); never on the keystroke path (FR-008, FR-008c).

### 3.3 Selection size — derived, not stored

```ts
/**
 * Sum of every selection range's length (FR-004), a line break counting one (FR-004a).
 * `null` means NO SELECTION, which renders as nothing at all — never as `0` (FR-005).
 */
type SelectedCharacters = number | null;
```

Computed from `state.selection` alongside the caret, in the same synchronous pass. Not stored: it is
a pure function of a selection that the caret update already has in hand, and caching it would create
a second thing that can go stale.

---

## 4. The pure counting rules

`packages/core/src/editor/document-metrics.ts` — no DOM, no CodeMirror, no OS. This is what the unit
tests assert against, and what makes the rules checkable without an editor.

| Function | Rule | Worked example |
|---|---|---|
| `countCharacters(text)` | every character, a line break counting **one** however it is spelled | `"ab\r\ncd\r\nef"` → **8**; the same text in LF → **also 8**; ten empty lines → **9** |
| `countWords(text)` | count of maximal non-whitespace runs | `const foo_bar = "hello-world";` → **4** |
| `caretPosition(text, offset)` | 1-based line, 1-based character column; a tab counts 1 | `"\t\tfoo"` at offset 2 → line 1, **column 3** |
| `selectedCharacters(ranges)` | sum of range lengths under the same rule; `null` when every range is **zero-length** | two ranges of 30 and 33 → **63**; a selected line ending → **1**; three bare carets → **null** |

**FR-003a was REVERSED after implementation** (spec.md Clarifications, 2026-08-25): character counts
now **include** line breaks, where they previously excluded them. The figures above are the reversed
ones — `"ab\r\ncd\r\nef"` was 6 and is 8, ten empty lines was 0 and is 9. The EOL-conversion property
survives the reversal because a **CRLF pair counts one**, so a conversion changes how a break is
spelled and not how many there are.

**"Zero-length", never "empty".** The two are easy to conflate. A range is zero-length when it covers
no text at all — a bare caret — and that is what yields `null`. A range that covers only a line
ending is a real selection of one character and reports **`1`**. Reading the rule as "empty of
counted characters" would make `selectedCharacters` return `null` for a real selection, which FR-004
forbids.

**The consequence that has GONE AWAY, recorded because the old note said the opposite.** Put the
caret at column 1 of a blank line and press `Shift+Down`: the selection covers exactly one line
ending. Under the original rule that rendered **`0 selected`** — a readout on screen announcing that
nothing was selected while something plainly was, which the wave-1 review flagged and which this
document used to explain rather than fix. It now reads **`1 selected`**, and the awkward case is
gone. `0 selected` is no longer reachable at all: a range that produces content produces at least
one character, and a range that produces none is the *no selection* case, which shows nothing (FR-005).

**One split-pair hazard in the implementation, not in the rule.** `selectedCharacters` takes each
range as a stream of chunks, and a chunk boundary can fall between the CR and the LF of one break.
Because the pair is one character, the count must carry "did the previous chunk end in CR?" across
the boundary; without it, CRLF text over-counts by one per line.

**One place FR-004a's equality does not hold: the empty document.** Select-all there gives one
zero-length range, indistinguishable from a bare caret, so the readout is absent while the total
reports `0`. FR-005 wins on purpose — see FR-004a in `spec.md`.

**Line-ending independence is the property worth testing directly**, because it is the one a reader
would not guess — and it is the property the reversal was careful to keep: `countCharacters` of the
same text with LF and with CRLF must be equal, and #71 (convert line endings) is the feature that
would otherwise break it.

---

## 5. Status bar segments

Not persisted; a static declaration the renderer and the fit logic share.

| Segment | Group | Kind | Label | Hide order |
|---|---|---|---|---|
| line | left | readout | `Ln` | 5th (last readout to go) |
| column | left | readout | `Col` | 4th |
| selected characters | left | readout | `selected` | 3rd |
| total characters | left | readout | `chars` | 2nd |
| total words | left | readout | `words` | **1st (first to go)** |
| language | right | control | — | **never** (FR-024) |
| word wrap | right | control | — | **never** (FR-024) |

**The order reads bottom-up from the table**: words go first, `line` goes last, and the two controls
are not in the ordering at all. `line` surviving longest is deliberate — it is the figure an error
message names, which is the reason #256 asks for the readouts.

**Truncation vs hiding** (FR-021, FR-022):

- **Labels** (`Ln`, `Col`, `chars`, `words`, `selected`) may truncate.
- **Figures** may **never** truncate — they are hidden whole, because `1,234` clipped to `1,23` is a
  smaller plausible number and therefore a lie.

**The accessible name is not the visible label** (FR-015): `Ln 412` reads as *"line 412"*. `Ln` is
not a word.
