# Quickstart / Validation Guide: Editor & Terminal Enhancements

How to prove each story works, by hand and by the automated gates. Run from the worktree root.

## Prerequisites

```bash
npm install            # worktree needs its own node_modules (junctions)
npm run build          # tsc -b + renderer + generated defaults
```

## Automated gates (the definition of done per story)

```bash
npm run typecheck                                   # tsc -b + renderer project
npm run lint                                        # eslint .
npx vitest run --project unit --project integration --project contract
npm run test:e2e                                    # Playwright + Electron (per-story e2e below)
```

Each story is complete only when its unit/contract tests and at least one e2e pass. The two bug
stories (US6, US7) each carry a regression test that **fails on `origin/master`** and passes here.

## Per-story manual validation

**US5 — editor auto-naming.** Open `foo.ts` in an editor panel → header reads `foo`. Open `bar.md` in
it → `bar`. Rename the panel to `Scratch`, open `baz.ts` → stays `Scratch`. "Reset Name" → `baz`. Edit
without saving → the unsaved dot appears beside the title (auto-named *and* renamed cases).

**US1 — editor word wrap + status bars + prefs.** In an editor with a long line: toggle Word Wrap from
the status bar, the content menu, or `Ctrl+Alt+W` → the line wraps; open the same file in a second panel
→ both wrap together. Preferences → Editor → toggle "Editor default word wrap" / "Show editor status
bar"; Preferences → Terminal → "Show terminal status bar". Hide the editor status bar → the bar goes,
`Ctrl+Alt+W` and "Set Language…" still work. Every terminal shows a status bar (no wrap control on it —
terminal wrap is #169).

**US2 — drag a file onto a terminal.** Drag a file from Files & Folders onto a terminal → its absolute
path appears at the prompt, quoted if it has spaces, with a trailing space and the cursor before it; the
line is not submitted. Drag several → all paths, space-separated. Drop onto an editor → nothing pasted.

**US6 — sub-menus + keyboard.** Right-click a file → hover "Open In" → sub-menu opens; **click** the
"Open In" parent → it stays open (the bug: today a second click closes it). Press `Shift+F10` (or the
Menu key) with a tree row focused → its menu opens; `↓`/`↑` move, `→`/`Enter` enter a sub-menu focusing
its first child, `←`/`Escape` step back out, `Enter` on a leaf runs it.

**US7 — terminal URLs.** In a terminal, print a URL (`echo https://example.com`) and `Ctrl+click` it →
it opens in your **system** browser, never an in-app window. Right-click a link (no selection) → "Open
Link" / "Copy Link Address"; with text selected → the ordinary Copy menu. A `javascript:`/`file:` "link"
opens nothing.

**US4 — drag a tree file onto an empty panel.** Split a new empty panel; drag a file from the tree onto
it → it becomes an editor on that file. On a sub-workspace window's empty panel → it converts to
project-owned and survives a restart. Drag a folder or a multi-selection → "not allowed", nothing opens.
A file already open elsewhere → that panel is revealed/focused instead.

**US3 — undo/redo tree ops.** With the tree focused: cut+paste a file then `Ctrl+Z` → it returns;
rename then `Ctrl+Z`/`Ctrl+Y` → reverts/re-applies; delete then `Ctrl+Z` → restored from the recycle
bin, `Ctrl+Y` deletes again. Restart the app → the same ops are still undoable. Make an undo impossible
(empty the recycle bin, or move the destination) then `Ctrl+Z` → a persistent error notice explains why;
nothing changes. `Ctrl+Z` with an editor focused → undoes text, not a file op.

## E2E test files (new or extended)

- `preferences-settings.e2e.ts` (+3 toggles), `editor-word-wrap.e2e.ts` (new), `editor-naming.e2e.ts` (new)
- `terminal-path-drop.e2e.ts` (new), `os-drop.e2e.ts` (extend for tree-drop / US4)
- `context-menu.e2e.ts` + `menus.e2e.ts` (parent-click regression, keyboard exit, `menu.open`)
- `terminal-links.e2e.ts` (new: Ctrl+click, window-open denial, link menu)
- `explorer-undo.e2e.ts` (new, US3), `migration-v8.integration.test.ts` (new)
- Contract: `file-system-contract.ts` (+restoreFromTrash case)
