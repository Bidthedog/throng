# Phase 0 Research: Editor Status Bar Readouts and Gutter Visibility

**Feature**: 040 | **Date**: 2026-08-25 | **Spec**: [spec.md](./spec.md)

Every decision below was taken by reading the code that exists, not by reasoning forward from the
requirement. Where the repository already solved a shaped-alike problem, that solution wins — a new
invention beside an existing pattern is a second thing to maintain and a second thing to learn.

---

## D1 — How the readouts get their data

**Decision**: extend the **single existing `EditorView.updateListener`** in
`packages/ui/src/renderer/editor/use-editor.ts:707`, adding two independently-guarded concerns
*above* its current early-return. No new listener.

**Why this is not a free choice.** FR-008 says no figure may add a listener of its own, and the
existing listener opens like this:

```js
const updateListener = EditorView.updateListener.of((update) => {
  if (!update.docChanged) return;
  ...
```

**It early-returns unless the document changed**, so a caret move never reaches it — CodeMirror
reports those as `update.selectionSet`. FR-001 requires line and column to follow a pointer click and
an arrow-key move, and neither of those changes the document. So the listener must widen, and the
danger is that everything currently below that guard *assumes* a document change: `replica.record`
sends the edit to the document authority, and the auto-save timer starts a save. Running either on a
selection-only update would send phantom edits and start spurious saves.

**Resolution — widen by adding above, never by relaxing the guard:**

```js
const updateListener = EditorView.updateListener.of((update) => {
  if (update.docChanged || update.selectionSet) publishCaret(panelId, update.state);
  if (update.docChanged) scheduleCounts(update.state);
  if (!update.docChanged) return;          // ← UNCHANGED; still guards everything below
  ...existing body, byte-identical...
});
```

The existing early-return stays exactly where it is and continues to guard exactly what it guarded.
A reviewer can confirm the old behaviour is untouched by reading one line.

**Alternatives rejected**:

- *A second `updateListener`* — forbidden by FR-008, and it would double the per-keystroke work in
  the hottest path in the editor.
- *Relaxing the guard to `if (!update.docChanged && !update.selectionSet) return;`* — this is the
  obvious edit and it is wrong: it lets selection-only updates fall into `replica.record`, which
  reports a change to the document authority that did not happen.

---

## D2 — Keeping the counts off the keystroke path

**Decision**: caret figures are computed **synchronously** in the listener; document counts are
**debounced at 200 ms** and computed from `update.state.doc`.

**Why**: FR-008a and FR-008b set exactly this split, and the split matches the cost. A caret position
is `doc.lineAt(head)` — a binary search over the line index CodeMirror already maintains, effectively
free. A character and word count is a full scan of the document, which at 5 MB is emphatically not
free and must never run per keystroke (FR-008c).

**Word counting is the expensive half and is not incrementalisable cheaply.** An edit at a word
boundary can join or split words, so a delta-based count needs the affected lines re-scanned anyway.
Given FR-008b permits a 200 ms lag, a debounced full scan is both simpler and correct, and simpler is
the right trade when the requirement already grants the latency.

**Alternatives rejected**:

- *Incremental maintenance from `update.changes`* — considered and rejected during clarification. It
  buys exactness the requirement did not ask for, and pays for it with word-boundary logic that is
  easy to get subtly wrong and hard to test.
- *A size threshold, exact below it and debounced above* — two code paths and a threshold nobody can
  see, so a defect in the large-document path hides on every developer's own test file.

---

## D3 — Making the gutter reactive

**Decision**: a **`gutterCompartment`**, reconfigured on the setting change, following the pattern
the repository already uses four times over.

**Why**: `commands.ts` already declares `wrapCompartment`, `indentCompartment` and
`commandKeymapCompartment`; `editor-language.ts` declares `languageCompartment` and
`functionHighlightCompartment`. The live-reconfigure idiom is established, tested and understood:

```js
useEffect(() => {
  viewRef.current?.dispatch({
    effects: wrapCompartment.reconfigure(wordWrapOn ? EditorView.lineWrapping : []),
  });
}, [wordWrapOn]);                                    // use-editor.ts:344
```

`editor.showGutter` is the same shape exactly — a boolean that must reach an already-open view
without a reopen (FR-043) and without disturbing scroll or selection (FR-044). Compartment
reconfiguration is precisely the CodeMirror mechanism that preserves both.

`lineNumbers()` is currently registered unconditionally in two places — `use-editor.ts:734` and
`standalone-editor.tsx` — and FR-042 requires **both** to read the one setting, so both get the
compartment. Missing the standalone one is the defect the issue explicitly warns about: the
preferences JSON editor would keep its gutter while every editor panel lost theirs.

**Alternatives rejected**:

- *Recreating the `EditorView` on the setting change* — loses scroll position and selection, which
  FR-044 forbids outright.
- *Hiding the gutter with CSS* — the gutter would still occupy layout, so the text would not start at
  the panel's left padding (FR-041), and the width the user was trying to reclaim would not come
  back.

---

## D4 — Width management: truncate, then hide, in a fixed order

**Decision**: **measure and drop** — a `ResizeObserver` on the bar reports the available width, and
the component renders the longest prefix of the segment list that fits, having first allowed labels
to shorten.

**Why not pure CSS**: the requirement is not "overflow gracefully", it is a *specific ordered*
degradation with a hard rule that **numbers must never be truncated** (FR-022). CSS `text-overflow:
ellipsis` cannot express "shorten this label, but if that is not enough, remove this whole segment,
and never clip that number" — and clipping a number is the exact failure the requirement names,
because `1,234` clipped to `1,23` reads as a smaller, plausible, wrong figure.

Container queries were considered and rejected for the same reason: they key off the *container's*
size, not off whether the content fits, so the breakpoints would be magic numbers that go wrong the
moment the language or the digit count changes — and the digit count changes constantly, which is
the whole problem.

**The two alignment groups (FR-013) fall out naturally**: a flex row with the readout group on the
left, the control group on the right, and the slack between them. FR-014's "neither group may
overlap" is then a property of flex layout rather than something to police, and FR-024's "the
right-hand group is never hidden by width" becomes "only the left group participates in dropping".

**FR-020's one-line height** is asserted, not assumed: the bar gets `white-space: nowrap` on a rule
whose **existing `min-height: 20px`** already fixes the line box, so no combination of content can
wrap it onto a second line and change the editor's height beneath it. **It does NOT get a fixed
`height`** — see T024: `min-height` is there deliberately, because the language picker pops *upward*
out of a 20px bar and a hard height would clip it.

**And the empty-left-group case is a real hazard, not a hypothetical.** With both readout toggles off
(US3 AS5) or every readout dropped at minimum width (US2 AS4), the left group has nothing in it — and
`justify-content: space-between` with one child puts that child on the **left**. That would move the
language label to the wrong edge and silently break 016 FR-010c, the shipped requirement Finding 1
exists to protect. So the readout group's container **renders unconditionally, empty or not** (T022),
and T033 asserts the language label stays in the right group with both toggles off.

---

## D5 — Where the caret and count state lives

**Decision**: **two stores, with different key scopes**, mirroring what `word-wrap-store.ts` already
does for a per-document flag.

| Store | Keyed by | Why |
|---|---|---|
| caret position | **panel id** | FR-006: the caret is view state, and Principle XI permits view state to differ per panel. Two panels on one document have two carets and must report their own. |
| document counts | **document** | FR-007: the counts describe the document, so every panel showing it must agree. |

**A simplification worth recording**: the counts could be computed per view rather than per document,
because two views of one document hold the same content and would therefore compute the same figures.
That is observationally identical and cheaper to write. It is rejected anyway — it makes FR-007 true
*by coincidence* rather than by construction, and the coincidence breaks the moment a view lags the
authority by one transaction, which is exactly the window `DocumentReplica` exists to manage. A
per-document store makes the requirement structurally true and costs one map.

---

## D6 — One level of grouping in the descriptor registry

**Decision**: an **optional `subgroup?: string`** on `FieldDescriptor`
(`packages/core/src/config/metadata.ts`), and a subsection renderer in each of the three tabs that
group by `group`.

**Why all three tabs, when only settings needs it today**: FR-036. `settings-tab.tsx`,
`keybindings-tab.tsx` and `themes-tab.tsx` each implement their own `groupDescriptors` over the same
registry shape. Teaching only the settings tab means one registry renders two ways, and the next
descriptor that carries a subgroup — the Terminal section is the stated next candidate — renders
correctly in one tab and silently flat in the others.

**The rendering rule mirrors the existing group behaviour exactly** (FR-036a–c), because that
behaviour is already what users expect and already tested:

- `settings-tab.tsx:413` maps groups to `<section>` with an `<h3>`, in **declaration order**, not
  collapsible → subgroups get a `<h4>` subsection, declaration order, not collapsible.
- Grouping runs over `matches` (line 168), i.e. **after** search filtering, so an empty group simply
  does not appear → an empty subgroup must disappear with its heading the same way.

**One detail the existing code forces**: `data-testid={`settings-group-${group}`}` at line 414 means
subsections need their own test id convention, or a test cannot distinguish a subsection from the
section containing it.

---

## D7 — Number formatting

**Decision**: `formatGrouped` from `@throng/core`, unconditionally, for every figure.

**Why**: constitution **5.4.0** — amended during this feature's clarification precisely because
4.5.0's gate was scoped to preference editors and did not reach this surface. The rule now covers
every surface and requires the one platform-agnostic formatter, so there is nothing to decide.

**What must NOT be grouped, and it is nearby**: 5.4.0 names three exclusions, and one of them is
adjacent to this feature — a number seeded into an editable field whose parser takes bare digits, as
`navigate/goto-line.tsx` documents. The readouts are display-only and never parsed back (FR-028), so
none of the exclusions apply here; they are recorded so the next reader does not have to re-derive
why.

---

## D8 — Test layers

**Decision**: the layer per behaviour, cheapest that can prove it, per Principle V and the
repository's `running-tests` rule.

| Behaviour | Layer | Why not cheaper / why not dearer |
|---|---|---|
| Counting rules — a line break is one char (FR-003a, as reversed), words are non-whitespace runs, multi-range selection sums | **unit** | Pure functions over a string. No editor needed. |
| Descriptor shape — the three keys exist, defaults, group/subgroup, completeness | **unit** | The registry is data; `settings-metadata.test.ts` already tests it this way. |
| Subgroup rendering — order, ungrouped-first, empty subgroup vanishes under search, no collapse control | **component** | jsdom renders the tab. No app, no daemon. |
| Bar rendering — segment presentation, accessible names, hidden-from-a11y-tree | **component** | Second-cheapest layer, and it carries assertions that used to cost an Electron launch. |
| Fit ordering — shorten then drop in order, figures never truncated | **unit** | A pure function of available width and measured segment widths. No DOM at all. |
| Fit *wiring* — the bar observes its width and applies the result | **component** | Asserts the wiring, not the geometry. A `ResizeObserver` stub feeds it widths; eight component tests already have that stub. |
| **Anything that is genuinely a MEASUREMENT** — the bar's one-line height, the two alignment groups not overlapping, the text's left edge once the gutter goes | **E2E** | **jsdom has no layout.** `tests/component/setup.ts` says so outright, and the CSS precedent (`notice-pointer-events.test.ts`) asserts declared keywords only, never resolved lengths, because jsdom does not resolve `var()`. The component tier asserts the *declared properties* — `white-space: nowrap` and `justify-content: space-between`, but **not a height**: `.editor-status-strip` already declares `min-height: 20px`, so a height assertion would be green on arrival and prove nothing. The real measurement is E2E. A component test that appeared to measure would be worse than none — it would read as coverage while asserting nothing. |
| Gutter registered *through a compartment* and reconfigured on the setting | **component** | What is provable without a live view: that `lineNumbers` goes in via the compartment rather than unconditionally, and that a settings change dispatches a reconfigure. |
| Gutter actually reaches an already-open view; standalone editor agrees; text moves to the left padding | **E2E** | Needs a real CodeMirror view in a real window. The *effect* of a compartment reconfigure on rendered output is not observable in jsdom, even though its *registration* is. |
| Readouts follow the caret through a real click and real arrow keys | **E2E** | Real keyboard and real focus — the reserved case in Principle V's E2E list. |

Everything else stays below E2E deliberately. The E2E budget is a ratchet
(`packages/ui/tests/e2e/e2e-budget.json`) and every added test is paid for on every push.

---

## Open risks carried into the plan

1. **The `updateListener` widening is the highest-risk edit in the feature.** It is one line in the
   hottest path in the editor, and getting it wrong sends phantom edits to the document authority.
   The mitigation is structural (add above the guard, never relax it) and it is worth a test that
   asserts a selection-only update produces no `replica.record` call.
2. **`ResizeObserver` in jsdom** needs a stub for component tests. Check whether the repo already has
   one before writing a second.
3. **The E2E budget ratchet** fails both ways — over budget, and under it without re-seeding. Adding
   E2E tests means re-seeding `e2e-budget.json` in the same commit.
