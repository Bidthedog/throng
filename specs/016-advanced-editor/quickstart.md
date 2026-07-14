# Quickstart — 016 Advanced Editor (Part 1)

How to run and validate this feature. Scenarios map to the spec's user stories and success criteria.

## Prerequisites

```bash
npm install          # @codemirror/lang-* grammars + @codemirror/legacy-modes are new deps
npm run build        # tsc -b + generate:defaults + renderer bundle + stamp:build
```

## Gates (all must be green — constitution v3.15.0)

```bash
npm run lint             # ESLint, ZERO errors (a lint error is a build failure)
npm run typecheck        # tsc -b
npm run test:unit        # parallel
npm run test:integration # SERIAL — spawns real OS processes
npm run test:contract    # SERIAL — includes runClipboardContract
npm run test:e2e         # Playwright-Electron, real on-screen windows
```

> **Run a suite ONCE, unfiltered, and capture the complete output** (Principle V). Parse the captured
> output as many times as you like; re-run only the failing tests, then the full suite once to prove
> nothing else broke. A test that fails then passes with **no code change** is **flaky, not fixed**.

> **E2E parallelism.** The default is 6 workers, benchmarked on a 10-core/20-thread machine (25 peak
> Electron processes). On an 8-core box this exhausts the Windows desktop heap and workers die with
> `STATUS_DLL_INIT_FAILED` (`0xC0000142`). Use `THRONG_E2E_WORKERS=2`. Not a defect — an environment limit.

## Manual validation

Launch: `npm start`

### US1 — highlighting & detection (P1)
1. Open a `.ts`, `.py`, `.rs`, `.go`, `.json` file → each is highlighted appropriately; the status strip
   at the panel's bottom names the language.
2. Type new code → it highlights **live**, without reopening.
3. Type a `#!` shebang into a `.txt` file → the language does **not** change (detection never reads
   content).
4. Open `types.d.ts` → **TypeScript** via the longest declared suffix (`.d.ts` beats `.ts`).
5. Open `.gitignore` and `Dockerfile` → **plain text**, no error (no extension in Part 1).
6. Open a `.h` file → **C++**. Remap `.h` → C in Settings → open `.h` editors switch to **C** without
   reopening.
7. Open `bundle.min.js` → the long line renders **unhighlighted** but fully editable; the rest of the
   document highlights normally.
8. Switch theme (Matrix → Light) → syntax colours repaint **live**; code stays legible on both.

### US2 — content context menu (P2)
9. Right-click the text area → Cut / Copy / Paste / Select All / Undo / Redo / **Set Language…**.
10. Right-click **inside** a selection → it survives. Right-click **outside** → selection collapses, caret
    moves to the click point.
11. With **nothing selected**, choose Copy, then paste mid-line elsewhere → a **whole line** is inserted
    **above** the caret's line (never a disabled item).
12. Right-click the panel **header** → still the 006 Save/Revert menu, unchanged and distinct.

### US3 — cut-line (P2)
13. Caret on a line, no selection, `Ctrl+X` → the whole line goes; lines below shift up.
14. Paste **mid-line** elsewhere → the line reappears **above**, and the caret's line is **not split**.
15. Copy something in **Notepad**, return, paste → **verbatim at the caret** (the full-line marker was
    invalidated by another source).
16. Rebind `cut-line` in Key Bindings → the new chord carries the whole behaviour, and **`Ctrl+X` reverts
    to native cut**. No restart.
17. In the **File Explorer**, `Ctrl+X` still cuts a **file** — `cut-line` and `file.cut` legitimately share
    the chord because their scopes are disjoint.

### US4 — indentation (P2)
18. Open a **tab-indented** file → `Tab` inserts a **tab**, even if the language is configured for spaces.
19. Open a **4-space** file whose language is configured for 2 → `Tab` inserts **4 spaces**.
20. Open an **unindented Go** file → `Tab` inserts a **tab** (Go's shipped override).
21. Select three lines, `Tab` → all three **indent** (the selection is **not replaced**). `Shift+Tab` →
    all three outdent.
22. Change the **tab display width** → open editors re-render; **no content changes and nothing goes
    dirty**.
23. Open any file → **no existing line is modified** and the document is **not dirty**.

### US5 — language override (P3)
24. Open an extension-less file → strip reads **Plain Text**. Click it → searchable picker → filter →
    choose a language → re-highlights **immediately**; `Tab` now uses that language's profile.
25. **Restart** → the panel reopens in the overridden language (it is persisted **keyed by the file**).
26. Tear the panel into a sub-workspace → the mirrored view shows the **same** language and indicator.

### US6 — column selection (P3)
27. **Alt+drag** across 3 columns of 10 lines → a rectangular block.
28. Copy → paste into **Notepad** → 10 rows separated by line breaks.
29. Copy a block, caret elsewhere, paste → each row lands **column-wise** on successive lines.
30. **Shift+Alt+Arrow** from a caret → the block grows by column/row.
31. Type with a block active → **every row** replaced, as **one** Undo.
32. **Delete**/**Backspace** with a block → the block clears on every row, **without** touching the
    clipboard.
33. Copy 10 lines in **another app**, paste over a **10-row** block → distributed **one line per row**
    (the only route for external column data to enter a block).
34. Paste a block past a short line's end in a **tab-indented** file → padded with **tabs to the last whole
    tab stop, then spaces** — never a run of spaces.
35. Undo a ten-row column paste → reverted by **one** Undo, restoring the prior selection.

### Cross-cutting
36. **Undo past a save** → the document returns to its pre-save content and is **dirty** again.
37. **Revert** → the undo history is **cleared** (it described content that no longer exists).
38. Kill the app mid-edit, relaunch → content **and undo history** are recovered. Turn
    `persistUndoHistory` **off** → already-persisted history is **purged**; a crash still recovers the
    **content**.
39. Open 013's **find bar**, press `Tab` → it moves **within the bar** and does **not** indent the file.
40. Focus a **Terminal Panel**, press `Ctrl+X` → it reaches the **shell** (PTY passthrough is unaffected).
41. Preferences → Settings → the two **keyed-map** settings render in the new keyed-table control;
    duplicate/invalid keys are **rejected**. Reset the extension map → it **clears**. Reset the indentation
    map → it **repopulates** (Go → tabs, Python → 4 spaces), it does **not** empty.
42. Preferences → Themes → the 10 syntax tokens and the status-strip tokens are all editable. **Restore All
    Themes to Default** → code stays styled (every bundled theme ships a value for every token).

### One document, one state (constitution XI · SC-013)
43. **Mirror a panel into a sub-workspace window** (006 FR-034) so one file has **two views**. Type in view
    **A** → view **B** shows the edit. Now press **Ctrl+Z in view B** → it reverts **A's** edit (one shared
    undo stack, FR-026c), **both** views update, and the **dirty state agrees in both** (FR-028). Scroll the
    two views to **different regions** and confirm they stay independent — cursor and scroll are *view* state
    (FR-028c), everything else is *document* state.
    *(The **FR-028f rebase** is deliberately **not** a manual step: a single user cannot type in two windows
    at once, so the race is not hand-observable. That is exactly why **SC-013b** requires it to be
    **constructed** in an automated test rather than waited for — a race you cannot reproduce by hand is one
    that reaches production.)*
