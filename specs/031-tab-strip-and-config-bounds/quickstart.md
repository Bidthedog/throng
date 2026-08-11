# Quickstart: validating feature 031

**Feature**: 031 | Phase 1 output

How to prove this feature works, by hand and by suite. Details live in
[contracts/](./contracts/) and [data-model.md](./data-model.md) — this is the run guide.

## Prerequisites

```bash
npm install          # once per worktree; worktree-bootstrap does this
npm run build        # E2E has a pretest build, but a manual session needs it explicitly
```

Everything runs from the worktree root. A manual session needs at least one project registered with
a real folder.

## The gates

```bash
npm run lint                 # 0 errors
npm run typecheck            # clean
npm run test:unit            # the guard, grapheme counting, match predicate, strip geometry
npm run test:integration     # settings read → correct → write-back
npm run test:e2e             # every user-visible behaviour (two tiers locally, ~21 min)
```

Or `npm test` for all four layers, fail-fast, in one run — capture it to a file and parse the
capture (see the `running-tests` skill; the E2E layer is minutes long and is not worth paying for
twice).

## Scenario 1 — the defect is gone (US1)

The one that matters most: it is the reported bug and the regression most likely to creep back.

1. Open a project; note a tab's height and vertical position.
2. Create tabs until the strip overflows — three or four long names is enough.
3. **Expect**: no horizontal scrollbar anywhere in the strip; every tab has exactly the height and
   vertical position it had in step 1; the `+` button is still at the right-hand edge, square and
   vertically centred.
4. Scroll the strip so tabs are hidden on both sides. **Expect**: a fade over the left-most tab's
   leading edge and the right-most tab's trailing edge, with no tab having moved horizontally.

**Automated**: the E2E measures `getBoundingClientRect()` for a tab before and after overflow and
asserts equality — asserting the *geometry* rather than the absence of a CSS class, because the
class could be right while the layout is wrong.

## Scenario 2 — a hand-edited setting cannot break the app (US2)

1. Close throng. Open `settings.json` in the user profile.
2. Set `panes.projects.maxWidth` to `50`, `terminals.linkHoverDelayMs` to `4000`, and add an entry
   to `editor.indentByLanguage` with `indentWidth: 500`.
3. Start throng, then reopen the file.
4. **Expect**: `200`, `2000` (the *declared* range, not the old hand-written 5000) and `16`
   respectively — and the file now says so.
5. Start throng again with everything in range. **Expect**: the file is **not** rewritten (check the
   modified timestamp).

**Automated**: an integration test per case, plus a unit test that **enumerates** `SETTINGS_METADATA`
and asserts the clamp for every bounded descriptor — the point being that a test listing settings by
hand would pass while a new one went unguarded.

## Scenario 3 — reaching a tab you cannot see (US3)

1. With the strip overflowing, read the tab-actions group left of `+`.
2. **Expect**: `‹ (n)`, `› (n)`, `⌄ (total)`, with the counts matching what is actually hidden.
3. Click `›`. **Expect**: exactly one tab of movement, eased in and out, the revealed tab flush with
   the left edge.
4. Click `›` twice quickly. **Expect**: two tabs of movement, settling **once** — not two animations
   back to back, and no drift after you stop.
5. Press `Ctrl+Alt+T`. Type two words from a tab's name **in the wrong order** (e.g. `find file` for
   a tab called *file find*). **Expect**: it still matches, with both terms highlighted.
6. Choose it. **Expect**: the strip scrolls to that tab and it becomes active.
7. Settings → Tabs → set smooth scroll to `0`. **Expect**: scrolling is instant.
8. Turn on Windows' *Show animations* off (Settings → Accessibility → Visual effects). **Expect**:
   scrolling is instant regardless of the configured duration, and the setting still reads what you
   set.

## Scenario 4 — names cannot run away (US4)

1. Rename a tab. Type past 54 characters. **Expect**: a counter appears showing used/64.
2. Keep typing to 64. **Expect**: input stops; the counter reads at-limit; **no error styling**.
3. Paste a long path into the field. **Expect**: as much as fits is inserted, counter at-limit.
4. Paste ten emoji into a fresh rename at a limit of 10. **Expect**: all ten accepted, none cut in
   half.
5. Settings → Tabs → lower the limit to 10, then raise it back to 64 **without touching anything
   else**. **Expect**: the full names come back.
6. Lower it again, rename a *different* tab (which saves the layout), then raise it. **Expect**: the
   shortened names stay short — this is the persistence transition, and the one place the behaviour
   is deliberately lossy.

## Scenario 5 — a tab says what is inside it (US5)

1. Hover a tab holding several panels. **Expect**: the tab name, the panel count, and each panel's
   name on its own line; the count renders as a pill, not `[3]`.
2. Move the pointer across the strip **quickly**, passing over several tabs without stopping.
   **Expect**: no tab is destroyed — the close affordance is inert for its arming delay.
3. Rest on a tab, wait, then click its `✕`. **Expect**: the ordinary Destroy Tab confirmation, and
   the tab is not activated by the click.
4. Watch the tab widths as the pointer enters and leaves. **Expect**: nothing reflows — the space is
   reserved whether or not the affordance is showing.
5. Reduce to one tab in the main window. **Expect**: its close affordance is unavailable, matching
   the disabled Destroy Tab menu item.

## What "done" looks like

- All five scenarios behave as described in a real session.
- `npm test` green across all four layers.
- Every new E2E spec registered in `shard-plan.json`, and the picker/settings specs also in
  `parallel-plan.json`'s serial tier — `shard-plan.test.ts` fails the build otherwise, because a
  spec in no group runs nowhere and does so silently.
