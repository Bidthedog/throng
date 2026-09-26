# The E2E reserve, replacing an E2E, and the `@reserve:*` tags

Read before adding, demoting or deleting an E2E test, or when choosing its `@reserve:*` tag.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## The E2E reserve

E2E is where you land when nothing cheaper can show it. The constitution enumerates
what qualifies (v5.2.0): **window lifecycle; focus and z-order; native menus; OS
drag-and-drop; PTY fidelity and process-tree hygiene; real keyboard and input
dispatch; and real layout and text rendering**.

Two of those are recent, and both were added because a real test had nowhere to go:

- **Real layout and text rendering** — anything whose truth depends on how the engine
  actually laid the text out: a caret’s position against a drawn gutter, what is
  scrolled into view, the height of a wrapped line, a measured rectangle.
- **Real keyboard and input dispatch** — what a real engine reports for a chord, and
  whether a real keystroke reaches the real handler. A synthesised `KeyboardEvent`
  asserts the shape the TEST chose; only a real one asserts what the browser decides,
  and that difference is where modifier handling and layout-dependent chords go wrong.

Read the list as a growing set of worked examples, not a closed set. Twice now a
legitimate test has classified under none of the entries, and each time the honest
move was to amend the enumeration rather than force the test down a layer where it
would assert its own premise.

Two traps worth naming, because both have happened here:

- **A cheap test that passes while the bug is real means the layer was wrong, not
  that the bug was.** Step down further, or find the seam you have not modelled.
- **A test that drives a real app to read an attribute is at the wrong layer**, even
  when the attribute is genuinely important. If the claim is about markup, the
  component layer makes it — and usually makes it better, because the questions stop
  costing an app launch each and the branches a single running window could never
  show at once become reachable.

## Replacing an E2E test rather than deleting it

FR-046: write the replacement FIRST, prove it goes red when the behaviour breaks,
and only then remove the E2E. The Red proof is not optional and it has a failure mode
of its own — **assert that the mutation actually applied before believing the
result.** A mutation that silently edited a comment, or that a resync effect
immediately overwrote, reports "not coupled" and proves nothing; that has happened
four times in this repo's own migration work.

FR-047: a partial replacement is not a replacement. If the component test covers four
of a test's five claims, the test is NARROWED to the fifth — it is not deleted.

## The third tag: which reserve entry makes this irreducible

Spec 035 added a third class of tag. A significance tag says which lane a test runs in
and a category says what area it covers; **neither can tell you whether a test still
needs the running application at all.** 035's census read all 229 spec files (the suite as it then stood) and found
that class repeatedly: `tree-drop-open.e2e.ts` justified all five of its tests by the OS
drag-and-drop reserve while dispatching a synthetic in-page `CustomEvent` that jsdom
reproduces identically, and `subtree-expand-collapse.e2e.ts` claimed the native-menu
reserve for an in-document React menu. Both claims were true when written and rotted in
silence, because nothing ever re-checked them.

So every E2E test names the constitutional reserve entry it relies on, from a closed
vocabulary:

| Tag | The entry it names |
| --- | --- |
| `@reserve:window` | real window lifecycle and multi-window behaviour |
| `@reserve:focus` | focus and z-order across windows |
| `@reserve:native` | native menus and dialogs |
| `@reserve:osdrag` | OS drag-and-drop |
| `@reserve:pty` | PTY/ConPTY keyboard and rendering fidelity |
| `@reserve:process` | process-tree hygiene |
| `@reserve:layout` | real layout and rendered appearance — geometry, colour, cascade |
| `@reserve:input` | real keyboard and input dispatch |
| `@reserve:runtime` | real application-runtime identity |

The identifier is stable and the constitution's prose is not — v5.3.0 reworded the layout
entry to cover colour and cascaded style without touching a single test, which is the
whole argument for a tag over a quoted sentence.

**`reserve-tag-debt.json` is the migration ratchet**, the same both-ways shape as the
budget. It records how many tests do not yet name an entry; the number may fall and must
never rise. Tags are added **by reading the test**, never inferred: a codemod over the
whole suite tagged 443 tests and put 205 under `@reserve:input`, because `.press(` and
`.type(` appear in nearly every spec here. Restricting it to unambiguous APIs did no
better — it read `process.execPath` out of a test's daemon *setup* and called the test a
runtime-identity claim. The evidence for a test's **claim** is not lexically
distinguishable from the evidence for its **setup**, so an automated tag is a
confident-looking false justification: the exact defect the tag exists to remove.
