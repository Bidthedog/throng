# Quickstart: validating feature 033

**Feature**: 033 | Phase 1 output

How to prove this feature works, by hand and by suite. Details live in [contracts/](./contracts/) and
[data-model.md](./data-model.md) — this is the run guide.

## Prerequisites

```bash
npm install          # once per worktree; worktree-bootstrap does this
npm run build        # E2E has a pretest build, but a manual session needs it explicitly
```

Everything runs from the worktree root. A manual session needs at least one project registered with a
real folder, and for Scenario 1 that folder should be a **deep** one — a checkout with `node_modules`
in it is ideal, because it is also the case that exercises the exclusion rules and the watcher's storm
handling at the same time.

## The gates

```bash
npm run lint                 # 0 errors
npm run typecheck            # clean — and this is the FR-049 gate: an item with no section fails HERE
npm run test:unit            # the walk, the diff, compiled matching, ranking, the line clamp,
                             #   the section vocabulary, the subtree targets, the guard-shape scan
npm run test:integration     # the file index over a real temp tree and a real watcher
npm run test:e2e             # every user-visible behaviour (two tiers locally, ~21 min)
```

Or `npm test` for all four layers, fail-fast, in one run — capture it to a file and parse the capture
(see the `running-tests` skill; the E2E layer is minutes long and is not worth paying for twice).

## Scenario 1 — reaching a file you have not found (US1)

1. Open a deep project. Press **Ctrl+Shift+T** with a **terminal** focused.
2. **Expect**: a centred modal with a focused, empty input — and **nothing typed into the terminal**.
   That last half is the point of FR-003 and is easy to miss.
3. Type two words from a path **in the wrong order** (`file find` for `src/find/file.ts`).
   **Expect**: it still matches, with both runs marked, and each row showing the full path.
4. Type a single common letter in a large project. **Expect**: the list appears with no perceptible
   delay, and a line saying how many of how many matches are shown once it passes 200 rows.
5. Press **Down** twice, then **Enter**. **Expect**: the third listed file opens.
6. Reopen and press **Escape**. **Expect**: nothing opens, and focus is back in the terminal.
7. Reopen from inside an **editor** panel. **Expect**: a two-option control **above** the input,
   preselected from Settings → *Open files in*. Type immediately — the characters go to the input.
8. Press **Shift+Tab**, then **Space**. **Expect**: the control takes focus and its value changes, and
   **no file opens**. Press **Enter** on it. **Expect**: the value changes again, and still no file
   opens. That is FR-010b, and it is the requirement most likely to regress.
9. Choose a file that is **already open** in some editor. **Expect**: that editor is focused — not a
   second copy.
10. Choose a file for an editor holding **unsaved changes**. **Expect**: the ordinary unsaved-changes
    prompt, and Cancel leaves the buffer untouched.
11. With Files & Folders showing, hover the new **Quick Open** toolbar button. **Expect**: a tooltip
    naming the action *and the current chord*. Rebind the chord in Preferences → Key Bindings and hover
    again. **Expect**: the **new** chord.
12. Close every project. **Expect**: the button is **greyed, not gone**, and the chord opens nothing.

### The two that need a second project

13. Add a second project with its own files. From the first, search for a file that exists only in the
    second. **Expect**: nothing listed.
14. Create a folder matching an exclude glob and put a file in it. **Expect**: it is never listed.

### Live updating

15. With the modal closed, create a file from a terminal (`ni newthing.txt` / `touch newthing.txt`).
    Open Quick Open and search for it. **Expect**: it is there, within a couple of seconds. Delete it
    and repeat. **Expect**: it is gone.

**Automated**: the 50,000-file budget is measured at the **unit** layer over the pure pipeline, and the
E2E asserts the half a unit test cannot — that typing issues **zero** filesystem calls. See
[contracts/file-index.md §5](./contracts/file-index.md).

## Scenario 2 — line 412 (US2)

1. Open a file longer than a screen. Press **Ctrl+G**, type a line number, press **Enter**.
2. **Expect**: that line scrolls into view, the caret sits at its first column, and **the gutter beside
   the caret shows the number you typed**.
3. Turn **Word Wrap** on, find a line long enough to wrap, and repeat. **Expect**: the same answer —
   the number counts logical lines, which is what the gutter draws.
4. Enter a number larger than the file. **Expect**: the last line, and **no error notice**. Enter `0`,
   then `-5`. **Expect**: the first line, twice, and still no notice.
5. Press **Ctrl+G**, then **Escape**. **Expect**: caret, selection and scroll exactly as they were.
6. Press **Ctrl+G** and submit an empty box, then a non-numeric one. **Expect**: nothing moves.
7. **Focus a terminal** and press **Ctrl+G**. **Expect**: no modal, and the shell receives `^G` exactly
   as it would without this feature.
8. Open a **find bar** (Ctrl+F), type a query, note the match count. Now Go To Line and jump.
   **Expect**: the find bar is still open, with the same query, the same count and the same highlights —
   and focus is in the **editor**, not in the find bar.
9. Right-click in the editor. **Expect**: **Go To Line** on the menu, showing its chord.

## Scenario 3 — menus you can read (US5)

1. Open each menu in turn: a file row, a folder row, the tree's empty space, an editor's content, a
   terminal's content, a panel header, a tab, the cog.
2. **Expect**: items fall into the declared sections in the declared order, with a divider between
   adjacent sections **and nowhere else**. The cog menu has **no** divider — see the note below.
3. **Expect**: no label, no icon, no chord and no ordering *within* a section has changed. If anything
   reads differently apart from where the dividers fall and where Destroy/Sync to/Reset Name sit, that
   is a defect.
4. Arrow through a menu with dividers. **Expect**: the dividers are skipped and never take focus.
5. Right-click a terminal **over a link**. **Expect**: Open Link and Copy Link Address still **lead**
   the menu, above Copy and Paste.

> **The cog menu is knowingly not what FR-052 asks for.** All five of its items are *Application* by the
> constitution's own table, and a divider is permitted only at a section boundary — so it carries none.
> The contradiction is recorded in [plan.md](./plan.md) and must be resolved by amendment before US5 is
> marked done.

## Scenario 4 — a shell where you are pointing (US3)

1. Right-click a **nested folder** → Open In → Terminal. **Expect**: a flavour list matching the panel
   type-picker's exactly.
2. Traverse the three levels with the **mouse**, slowly, then with the **arrow keys**. **Expect**: no
   intermediate flyout collapses either way.
3. Choose a flavour. **Expect**: a new terminal in the active tab, active, **not** in rename mode, its
   prompt in that folder.
4. **Type immediately, without clicking anything.** **Expect**: the characters reach the shell.
5. Right-click a **file** and do the same. **Expect**: the terminal starts in its parent folder.
6. Add a custom flavour in Settings → Terminal, and disable a built-in. Reopen the submenu.
   **Expect**: the custom one is there and the disabled one is not, with no further configuration.
7. Close every project. **Expect**: the Terminal submenu is **greyed, not gone**.

## Scenario 5 — tidying one branch (US4)

1. Drill three levels into a folder. Right-click the **top** folder → **Collapse All Children**.
   **Expect**: everything beneath is closed and **that folder is still open**.
2. Repeat on a folder with nothing expanded beneath it. **Expect**: nothing happens, and no error.
3. Right-click a folder with a mix of files and folders → **Expand All Children**. **Expect**: every
   immediate child folder open, **no grandchild** open.
4. Do it on a **closed** folder. **Expect**: it opens first, then its children.
5. Look inside every folder either action opened. **Expect**: real children — no folder renders as
   spuriously empty. This is the #120 desync and it is what SC-009 counts.
6. Right-click a **file**. **Expect**: neither item is there **at all** — not greyed.
7. Switch project and come back; then restart the app. **Expect**: the open state you left, both times.
8. Use the toolbar's Expand and Collapse all. **Expect**: exactly what they did before.

## Scenario 6 — proving the guard is a guard (#244, FR-053b)

This one is a **deliberate, recorded mutation**, not a test in the suite — a test that asserts another
test fails cannot live alongside it.

```bash
# 1. Green baseline
npx playwright test packages/ui/tests/e2e/menu-keyboard.e2e.ts

# 2. Remove the precondition: delete the `await row.click()` before the first guarded keystroke.
# 3. Run it again. It MUST fail, and fail in the guard rather than three assertions later.
npx playwright test packages/ui/tests/e2e/menu-keyboard.e2e.ts

# 4. Restore the click. Green again.
```

Paste the red output into the PR. The shipped guard passes all four times — that is the whole of #244,
and the demonstration is the only evidence that separates the replacement from it.

The **durable** protection is the new unit test, which fails the build if the vacuous shape reappears
anywhere under `packages/ui/tests/e2e/`:

```bash
npx vitest run --project unit packages/ui/tests/unit/focus-guards.test.ts
```

## What "done" looks like

- All six scenarios behave as described in a real session.
- `npm test` green across all four layers.
- Every new E2E spec registered in `shard-plan.json`, and every spec that drives a context menu, opens
  Preferences or asserts a wall-clock ceiling **also** in `parallel-plan.json`'s `serial` list —
  `shard-plan.test.ts` fails the build otherwise, because a spec in no group runs nowhere and does so
  silently.
- `docs/quick-start.md` names both chords, both explorer actions and both preferences; `README.md`
  still reads as a truthful snapshot.
- The cog-menu contradiction is resolved by a spec amendment, and the two deferrals in the plan's
  Complexity Tracking are open, labelled issues.
