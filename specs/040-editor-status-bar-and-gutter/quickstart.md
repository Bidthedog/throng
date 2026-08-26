# Quickstart: validating Editor Status Bar Readouts and Gutter Visibility

**Feature**: 040 | **Plan**: [plan.md](./plan.md) | **Contracts**: [settings](./contracts/settings.md) · [metadata](./contracts/metadata.md)

How to prove this feature works, from cheapest to dearest. Run the cheap rungs first — they answer
most questions in seconds, and the expensive ones only exist for what nothing cheaper can show.

---

## Prerequisites

```bash
npm install          # from the worktree root
npm run build
```

**If an E2E disagrees with a unit test about a constant, rebuild `dist` before debugging the code.**
Vitest resolves `@throng/core` to source; the Electron app loads `packages/core/dist`. A stale `dist`
makes every cheap layer agree while every E2E runs against different values — it has cost this repo a
full gate run before:

```bash
rm packages/core/tsconfig.tsbuildinfo && rm -rf packages/core/dist && npm run build
```

---

## 1. The counting rules (unit — seconds)

The rules are pure functions, so they are provable without an editor at all.

```bash
npx vitest run --project unit document-metrics
```

**Expected** — the four rules from [data-model.md](./data-model.md):

| Input | Expected |
|---|---|
| `"ab\r\ncd\r\nef"` | 8 characters — six letters and two breaks, each break counting one |
| the same text with LF | **also 8** — an EOL conversion must not move the figure |
| ten empty lines | 9 characters — nine breaks |
| `const foo_bar = "hello-world";` | 4 words |
| `"\t\tfoo"`, caret at offset 2 | line 1, **column 3** — a tab counts 1 |
| two ranges of 30 and 33 | 63 selected |
| three bare carets, no ranges | **null** — no selection, so nothing renders |

## 2. The settings exist and are complete (unit — seconds)

```bash
npx vitest run --project unit settings-metadata-040 settings-gutter-040
```

**Expected**: the three new keys have descriptors, correct defaults, and the completeness test passes.
A key without a descriptor fails the build, which is the point of the gate. *(Both filenames are
named because `editor.showGutter`'s descriptor test lives in its own file — a `settings-metadata`
filter alone would silently skip it.)*

## 3. The fit ordering (unit — seconds)

```bash
npx vitest run --project unit status-strip-fit
```

**Expected**: labels shorten to their declared forms (`selected`→`sel`, `chars`→`ch`, `words`→`w`;
`Ln` and `Col` never shorten) **before** anything is dropped; segments then drop in the order
**words → chars → selected → column → line**; the order stops at `line`, so the language label and
wrap toggle are never dropped; a figure is hidden whole and never truncated; and the result is
deterministic for a given width.

*(This is the **unit** tier, not component: the ordering is pure arithmetic over measured widths.)*

## 4. The status bar and the preference subsections render (component — seconds)

```bash
npx vitest run --project component status-strip
npx vitest run --project component settings-tab keybindings-tab themes-tab gutter-setting-row
```

**Expected**:

- Readouts are in the **left group**, language and wrap in the **right group** — *group membership,
  not pixel positions.* jsdom has no layout, so the measured alignment claim is §6.2's, by hand, and
  the E2E's.
- Each readout reads as `line 412`, not `Ln 412` and not `412`.
- The bar's rule declares `justify-content: space-between` and `white-space: nowrap`.
- Editor → **Status Bar** is a subsection; Editor's own ungrouped settings appear **above** it; a
  search matching nothing in it removes the heading too; there is no collapse control.
- `editor.showGutter` renders as an editable toggle row in the Editor section.

## 5. The whole gate (~20–25 minutes, E2E dominating)

```bash
npm run gate
```

This is the only thing that establishes done-ness. It stops at the first failure.

---

## 6. By hand, in the real app

```bash
npm start
```

### 6.1 The readouts

1. Open any source file in an editor panel.
2. **Expect** along the bottom of the panel: `Ln 1  Col 1` on the left, with `chars` and `words`
   figures beside them; the language name and the wrap toggle on the **right**.
3. Click somewhere in the middle of a line. **Expect** line and column to follow the click.
4. Press the arrow keys. **Expect** the figures to track, with no lag while you hold a key down.
5. Press <kbd>Tab</kbd> at the start of a line, then put the caret just after it. **Expect
   `Col 2`** — a tab advances the column by one, not to the next tab stop.
6. Select a paragraph. **Expect** a `selected` figure equal to the selection, appearing only now.
7. Press <kbd>Escape</kbd> / click to clear the selection. **Expect the `selected` segment to
   disappear entirely** — not to show `0`.
8. Hold <kbd>Ctrl</kbd>/<kbd>Alt</kbd> and drag a second selection (multi-range). **Expect** the
   figure to be the **sum** of both ranges.

### 6.1a Typing in a big file — the one performance claim that is deliberately manual

**This is the manual half of FR-008c.** The counting ceiling is automated (T044); "typing feels no
heavier" is not, because a relative wall-clock comparison between two app configurations is exactly
what this repo's latency precedent calls a flake generator.

8a. Open a **large file — 5 MB or more**. (`node -e "require('fs').writeFileSync('big.txt','x'.repeat(5e6))"` will make one, or use any big log.)
8b. With **Show counts** on, type a sustained burst — hold a key down, then type a paragraph at speed.
    **Expect the typing itself to feel exactly as responsive as in a small file.** The character and
    word figures may visibly lag behind while you type; that is the 200 ms debounce doing its job.
8c. Stop typing. **Expect the figures to catch up within a beat** — within about 200 ms, matching FR-008b rather than beating it — and to
    be correct.
8d. Turn **Show counts** off in Preferences and repeat 8b. **Expect no perceptible difference in
    typing responsiveness between the two.** If the counts-on case feels heavier, the counting has
    reached the keystroke path and FR-008 is broken, whatever the automated ceiling says.

### 6.2 Width degradation — the part most likely to be wrong

9. Drag the panel's edge slowly narrower, watching the bottom of the panel.
10. **Expect** the labels to shorten first, then whole segments to vanish in this order: **total
    words → total characters → selected → column → line**.
11. **Expect the language name and the wrap toggle to survive at every width.** They are the last
    things standing, and they must never disappear — if they do, that is 016 FR-010c broken.
12. **Expect the editor's text area not to move vertically at any point.** The bar stays exactly one
    line high; if the document's bottom edge shifts as you drag, the bar has wrapped.
13. **Expect no number to appear cut off.** `1,234` must never read `1,23`. A segment either shows its
    figure in full or is not there.
14. Widen the panel again. **Expect** every segment to return, with your caret and selection exactly
    where you left them.

### 6.3 The settings

15. Open Preferences → Settings and find **Editor → Status Bar**. **Expect** three settings together
    there — show the bar, show cursor position, show counts — and **expect no other Editor setting to
    have moved**.
16. Turn **Show cursor position** off. **Expect** line and column to go and the counts to stay.
17. Turn it back on and turn **Show counts** off. **Expect** all three counts to go and line/column
    to stay.
18. Turn **Show editor status bar** off. **Expect the whole bar to go**, whatever the other two say —
    and **expect <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>W</kbd> to still toggle word wrap**. Hiding the
    bar must not strand the command.
19. Read the **Show editor status bar** description. **Expect** it to mention the language, the wrap
    toggle, the caret position and the counts, and to say that hiding the bar overrides the others.
20. Type `status` into the preferences search. **Expect** matching settings to appear; type something
    that matches none of the Status Bar settings and **expect the Status Bar heading itself to
    disappear**, not to sit above an empty space.
21. Check the **Terminal** section. **Expect `terminals.showStatusBar` still directly under Terminal**,
    in no subsection.

### 6.4 The gutter

22. In Settings → Editor, turn **Show gutter** off.
23. **Expect** the line-number gutter to vanish from **already-open** editor panels, with no reopen
    and no restart, and the text to start at the panel's left padding.
24. **Open Preferences and look at the JSON editor there.** **Expect it to have lost its gutter too** —
    same setting, both surfaces. This is the one most likely to be missed, because the standalone
    editor registers `lineNumbers()` at its own call site.
25. Scroll down a long file, select some text, then turn **Show gutter** back on. **Expect** the
    gutter to return with **the same line still at the top** and your selection unchanged.
    **Expect the pixel scroll position to have moved slightly in a wrapped file, and that is
    correct** — hiding the gutter widens the text column, so long lines re-wrap and the same
    document position sits at a different pixel offset. Judge it by the line you were reading, not
    by whether the view looks pixel-identical (FR-044).
26. Open the Themes editor. **Expect the gutter colour tokens to still be there and still editable**,
    even with the gutter hidden — hiding it does not make its tokens inert.

### 6.5 Accessibility

27. With a screen reader running, arrow through the document. **Expect the status bar to say
    nothing** — you should hear only the line content the editor announces, exactly as before this
    feature. A readout announcing itself on every arrow key is the failure this is checking for.
28. Navigate onto the readouts. **Expect** them to read as *"line 412"*, *"column 7"*, *"1,204
    characters"* — not *"Ln 412"* and not a bare *"412"*.

### 6.6 Number formatting

29. Open a large file — one with more than a thousand characters is enough. **Expect the figures to be
    digit-grouped**: `1,204 chars`, not `1204 chars`.
30. **Expect grouping at every magnitude** — there is no size below which it is skipped.

---

## What to do when a step is wrong

Report it as ordinary feedback naming the step number. `speckit-iterate` maps a complaint back to the
step, the requirement behind it and the test that should have caught it, amends the spec additively,
and hands the fix back to autopilot. The numbered steps above are what it grounds that mapping
against, which is why they are written to be followed literally.
