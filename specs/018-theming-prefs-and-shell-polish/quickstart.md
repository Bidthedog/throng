# Quickstart: validating 018 by hand

**Phase**: 1 | Companion to [plan.md](./plan.md)

How to prove this feature works, driving the real application. Automated coverage is the gate; this is
the human check that the gate is measuring the right thing.

## Prerequisites

```bash
npm install          # first run in a fresh worktree — the workspace links are junctions
npm run build
```

## The gates (these must all be green)

```bash
npm run lint                # zero errors — a lint error is a build failure (constitution)
npm run typecheck
npm run test:unit           # ~830 tests
npm run test:integration    # ~199
npm run test:contract       # ~38
npm run test:e2e            # ~330 — capture the output; do not re-run to learn what it said
```

> **Run a suite once, unfiltered, and capture its complete output.** Parse the capture as many times as
> you need. Re-running an eleven-minute suite to recover a test name it already printed is the exact
> waste the constitution's test-run rule exists to stop — and a flaky test that passes on the second run
> launders a real defect into a green bar.

## US1 — A theme author can colour each surface independently

1. Open **Preferences → Themes** (the cog in the title bar).
2. Find the token labelled **Panel surface** and set it to something deliberately wrong for a menu — on
   a dark theme, near-white.
3. **Expect**: the Files & Folders pane changes.
4. **Expect**: the drop-down menus, row hovers, input fields and buttons **do not**.
5. Set **Menu surface** to a third colour. **Expect**: every menu in the application changes together —
   including the cog menu and the Key Bindings menu — and nothing else does.
6. Cycle every bundled theme. **Expect**: no surface is left visually stale.

**The negative case worth trying**: create a theme file by hand in the profile directory containing only
`{"colours":{"surface":"#ff0000"}}` and select it. **Expect**: the menus, inputs and hovers are all
**red** — not throng's default blue-grey. If they are blue-grey, the fallback was written in CSS and
FR-008 is broken. (This is the mistake the plan exists to prevent; there is already a dead example of it
in the tree.)

## US2 — Every menu obeys the theme

1. Open the **cog menu**. Switch theme while it is open. **Expect**: it repaints.
2. Drag the window so the cog sits near the **right edge**, then near the **bottom edge**. Open it.
   **Expect**: it flips and stays entirely on-screen.
3. Open the cog menu, then right-click a panel. **Expect**: the cog menu **closes** — one menu at a time.
4. Drive the cog menu with the **keyboard alone**: arrow keys, Enter. **Expect**: every item is
   reachable and activates. *(It is keyboard-reachable today; this must not regress.)*
5. **Preferences → Key Bindings**, right-click a bound chord. **Expect**: the shared menu, themed, with
   an icon — and its remove action still removes the chord.
6. Look at the cog's gear and the pane collapse chevrons. **Expect**: they come from the theme's icon
   pack — switch icon packs and watch them change.

## US3 — Scrollbars are part of the theme

1. On a dark theme, scroll: the preferences panels, the file tree, the editor, the project list, a menu.
   **Expect**: track, thumb and hover are theme colours. No light-grey bar.
2. **The one that matters**: resize a terminal panel narrow, then wide, with enough output to scroll.
   **Expect**: the text still wraps **before** the scrollbar; the last column is never overlapped. The
   terminal's bar must stay a classic non-overlay bar taking real width — xterm's fit calculation
   depends on it. This story **recolours** it and must not move it.

## US4 / US5 — The colour picker, and icon colour

1. **Themes → any colour swatch.** **Expect**: a themed picker — **no operating-system dialog**.
2. Drag around the saturation/value area. **Expect**: the application recolours live.
3. Type a hex value. **Expect**: it applies. Type `zzz`. **Expect**: it is **rejected**, the last valid
   colour stands, and the error shows on the row.
   *(Today `zzz` is written straight into the theme file on disk. This is a bug fix, not a preserved
   behaviour.)*
4. Drive the picker with the **keyboard alone**. **Expect**: every control reachable, operable, with a
   visible focus ring.
5. Press **Escape**. **Expect**: it closes and the last applied colour stands.
6. **The race worth trying**: open the picker, start dragging a colour, and switch theme mid-drag.
   **Expect**: the edit lands in the theme you were editing — **never** in the one you switched to.
7. Switch to a **light** theme, select the SVG icon pack. Set **Icon colour**. **Expect**: every icon in
   the app — toolbar, tree, tabs, menus, panels — changes together. Clear it. **Expect**: icons go back
   to inheriting their host control's colour, and no bundled theme looks any different than before.

## US6 — One way to confirm, one way to be notified

1. Trigger a destructive confirmation from **three** places: the preferences window (Reset all), the
   themes surface (Delete a theme), and the main window (Destroy a panel). **Expect**: all three present
   **the same way**.
2. Close the application with a running terminal. **Expect**: the same confirmation model — now with
   three choices and the terminal table — not a bespoke dialog.
3. Edit a file, close it without saving. **Expect**: the same model, three choices.
4. Force a failure in each error surface (projects, explorer, sub-workspaces, terminal exit, themes).
   **Expect**: all five notify **the same way**, and all five are dismissable.
5. Corrupt the workspace layout file to trigger the **restore notice**. **Expect**: it appears through
   the notification model and **can now be dismissed**.
6. **Expect**: an error notice does **not** auto-vanish. A success notice may.
7. **Expect**: "Reset to shipped defaults" and "Revert all" still read as **different operations** —
   they answer different questions and must not have been merged.

## US7 — Numbers are draggable and readable

1. **Preferences → Settings**. Find **Maximum openable file size**. **Expect**: `10,485,760` — grouped,
   readable as ten megabytes.
2. **Expect**: a slider beside it. Drag it. **Expect**: the number follows.
3. Type into the field. **Expect**: the slider follows.
4. Type garbage. **Expect**: rejected, last valid value stands, error on the row.
5. **The one that catches the regression**: paste a value and immediately press Tab (blur) — fast.
   **Expect**: the pasted value commits. *(A stale-render defect here was a real CI flake. It must not
   come back.)*
6. **Open the settings file on disk.** **Expect**: a plain number. **No grouping character may ever
   reach it.**

## US8 — Hidden files can be un-hidden

1. Right-click three files in the explorer → **Hide in this project**.
2. Click the new **options icon** on the File & Folders pane header. **Expect**: a themed dialog, naming
   the project, listing all three.
3. Remove one. **Expect**: it reappears in the tree **without a restart**.
4. Switch project. **Expect**: the dialog shows the **new** project's hidden paths, not the old one's.
5. Delete the project the dialog is editing. **Expect**: the dialog does not go on editing it.
6. With **no** project active, look at the pane. **Expect**: the options icon is absent or disabled.
7. **The trap worth trying**: hide a path that is *also* matched by a global exclusion glob (e.g. add
   `node_modules` to the globs, then hide it). **Expect**: the dialog **marks** it — because removing it
   will *not* bring it back, since the glob excludes it one stage earlier. A remove button that visibly
   does nothing would be worse than the bug being fixed.

## US9 — A file can be dragged in from the operating system

1. Drag a file from Explorer onto an **editor panel** in its own project. **Expect**: it opens.
2. Drag one onto an **untyped** panel. **Expect**: the panel becomes an editor showing the file, with no
   panel-type form.
3. Drag a file from **outside** the project onto a project-owned panel. **Expect**: a **visible
   rejection** explaining why — never a silent no-op.
4. Open a **sub-workspace** window (detach a tab). Drag a file onto a panel there. **Expect**: it opens —
   this is the only file-open affordance that window has.
5. Drag a file that lives **inside a project** onto a sub-workspace panel. **Expect**: **rejected**, and
   the notice says it belongs to a project. *(This file would have opened before this feature, and then
   refused to save — which is the trap being closed.)*
6. Drag a **folder**. **Expect**: rejected.
7. Drag a file that is **already open** in another panel. **Expect**: that panel is **focused** — not a
   second copy.
8. **The symlink case**: make a link inside the project pointing at a file outside it, and drop the link.
   **Expect**: rejected. The path is resolved to its real location *before* the rule is applied, so a
   link cannot smuggle a file past the boundary.
9. **The one that would have destroyed the app**: drag a file onto the title bar, the sidebar, the status
   bar — anywhere that is *not* a panel. **Expect**: nothing happens. **The application must not navigate
   away to the file.** *(Today it does — this is a live defect the feature closes.)*
10. While dragging a **panel** between tabs, and while dragging **within the explorer tree**, confirm
    neither drag system interferes with the other, and that an OS file drag shows a **copy** cursor
    rather than a **move** one.
