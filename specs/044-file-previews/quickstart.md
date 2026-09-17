# Quickstart: validating File Previews and Panel Navigation History

**Feature**: 044 | **Plan**: [plan.md](./plan.md)

How to prove this feature works, cheapest layer first. Types are in [data-model.md](./data-model.md)
and channel shapes in [contracts/](./contracts/) — not repeated here.

## Prerequisites

```bash
npm ci
npm run build
```

**The stale-dist trap.** Vitest resolves `@throng/core` to **source**; the Electron app loads
`packages/core/dist`. If an E2E disagrees with a unit test about a constant — a setting default, a
token count, `SHIPPED_DEFAULTS_VERSION` — rebuild before debugging:

```bash
rm packages/core/tsconfig.tsbuildinfo && rm -rf packages/core/dist && npm run build
```

## 1. The layers, in the order to run them

Load the `running-tests` and `throng-testing` skills first. One test command on the machine at a time.

The commands below are a **sample per layer**, not the full set. The complete list of new and amended
test files is the union of the "Red" checkpoint tasks in [tasks.md](./tasks.md) (T018, T035, T040,
T050, T062, T077, T094, T108, T117, T129, T145, T161), plus the tests that carry their own Red step —
T043, T066, T068, T153 and T167 — and the lower-layer cases T163c and T163d add before demoting an E2E
test. Run those files, not a glob.

```bash
npm run lint
npm run typecheck
npx vitest run --project unit packages/core/tests/unit/navigation-history.test.ts \
  packages/core/tests/unit/preview-registry.test.ts packages/core/tests/unit/preview-links.test.ts \
  packages/core/tests/unit/renderer-request-policy.test.ts packages/core/tests/unit/preview-settings.test.ts
npx vitest run --project component packages/ui/tests/component/preview-*.test.ts
npx vitest run --project integration packages/ui/tests/integration/preview-*.test.ts \
  packages/ui/tests/integration/navigation-history-*.test.ts
npx vitest run --project contract
npx playwright test packages/ui/tests/e2e/preview-hostile.e2e.ts packages/ui/tests/e2e/preview-scroll.e2e.ts \
  packages/ui/tests/e2e/navigation-history-keys.e2e.ts packages/ui/tests/e2e/preview-subworkspace.e2e.ts
```

Done-ness is `npm run gate`, dispatched to a hosted runner — never a local green bar:

```bash
gh workflow run gate.yml --ref feature/S044-I10-I136-file-previews
gh run watch <run-id> --exit-status
gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
```

## 2. Hands-on: the parented loop (User Story 1)

1. Open a project containing `README.md`. Open `README.md` in an editor.
2. In the editor's status bar, click the **preview** button.
   **Expect** a panel titled `README - Preview` to the editor's right, rendered; the button now pressed.
3. Type `# Hello` at the top and stop.
   **Expect** the heading in the preview within about 300 ms, without saving; the unsaved dot on
   **both** panels. Type continuously for three seconds: the preview updates at least once a second.
   **SC-002 check (T174):** repeat with `packages/ui/tests/fixtures/preview/long-1000.md` open in the
   editor and its preview beside it — pause after typing, and time how long the change takes to appear
   (SC-002: within 1 second; record the figure in the PR description, Open item O7).
4. Scroll the preview halfway down a long document, then type at the top of the editor.
   **Expect** the preview to stay where you were.
5. Right-click the editor body: *Open Preview* is **disabled**. Click the status-bar button again:
   the preview is focused; nothing new opens, nothing closes.
6. Save. **Expect** both dots to clear.
7. Rename the editor panel. **Expect** the preview's title to follow.
8. Destroy the editor and choose *Don't save*.
   **Expect** the preview to stay, show the file as on disk, lose the dot, and read
   `README - Preview` in the standalone form.

## 3. Hands-on: standalone, links, safety (User Stories 2 and 6)

1. With nothing open, right-click `docs/setup.md` → **Open In → Preview**.
   **Expect** a standalone preview and no editor; the Files & Folders row does **not** show the file
   as open. Right-click it again: *Open In → Preview* is disabled.
2. Edit `docs/setup.md` in another program and save. **Expect** the preview to update.
3. Open the same file from Files & Folders. **Expect** one editor, and the preview — where it stands —
   now showing the editor's unsaved state and name.
4. Hover a link: its target and "Ctrl+click to follow" show. Plain-click it: nothing happens.
   Ctrl+click an `https:` link: the default browser opens. Ctrl+click a link to `install.md#install`:
   **the same preview** shows `install.md` at its *Install* heading.
5. Tab through the links; press Enter (nothing), then Ctrl+Enter (followed). Press Shift+F10 on a
   focused link: *Open Link* / *Copy Link Address*.
6. Ctrl+click a link to a file that does not exist: one inline notice naming it; no file is created.
7. Preview `packages/ui/tests/fixtures/preview/hostile.md` with DevTools' Network panel open.
   **Expect** no dialog, no navigation, and no request other than `file:` app assets and
   `throng-preview:`. Then preview `packages/ui/tests/fixtures/preview/remote-images.md` with
   *Load remote images* on: its badge loads. Turn the setting off and refresh: the badge shows its
   alternative text and **no** request is made for it.
8. Switch theme. **Expect** the preview's text, links, code and tables to repaint without reopening.
9. Select a heading and a list, press Ctrl+C, paste into a rich mail composer (formatting kept) and
   into an editor (plain text). Right-click → *Copy as Plain Text*, paste into the composer: plain.

## 4. Hands-on: the panel itself, and preferences (User Stories 3 and 4)

1. Right-click the preview's header. **Expect** Close Panel, Reveal File in Files & Folders, Open in
   OS Explorer, Open in Editor / Go to Editor, Back, Forward, Send to Tab, Sync to, Refresh, Zoom —
   and **no** Rename, Reset Name, Save, Revert or Find. Double-click the title, press F2: nothing.
2. Zoom the preview in twice. **Expect** the parent editor's zoom unchanged.
3. With the preview focused, press Ctrl+S, type, paste, press Delete: nothing changes anywhere, and
   the Files & Folders selection is untouched.
4. **Preferences → Editor → Previews.** Set *Markdown: Default open action* to **Preview**. Click a `.md`
   not open anywhere: a standalone preview. Click one already open in an editor: its preview beside
   it. Open a `.md` result from Find in Files: an editor, at the match. *Open In → New Editor*: an
   editor.
5. Turn *Markdown: Enabled* **off**. **Expect** every Markdown preview in every window to close; the
   status-bar button **drawn disabled** with a tooltip naming the setting; both *Open Preview* items
   and *Open In → Preview* **disabled**; *Markdown: Default open action* and *Load remote images*
   **disabled** (still visible); and `.md` clicks to open editors. Turn it back on: *Default open
   action* is still **Preview**. Restart with it off: no Markdown preview restores, including one that was in a closed
   sub-workspace. If a preview was the only panel in the workspace, an empty panel replaces it; a tab
   it emptied is gone.
6. With a preview beside its editor, rename `README.md` to `GUIDE.md` in Files & Folders, then Save As
   `GUIDE.txt`. **Expect** the preview to follow to `GUIDE - Preview`, then to show one notice that
   the file type has no preview, with Close (FR-013c, FR-027).

## 5. Hands-on: history (User Story 7)

1. In one editor panel open `a.ts`, then `b.ts`, then `c.ts` from Files & Folders (*Open files in*:
   last active editor).
2. Click **Back** (top left of the header) twice → `a.ts`, Back disabled. **Forward** → `b.ts`.
3. Open `d.ts` into the panel. **Expect** Forward disabled, and Back → `b.ts` → `a.ts`.
4. Make the editor dirty and press **Alt+Left**. **Expect** the unsaved-open prompt; *Cancel* leaves
   the file and the Back/Forward state unchanged. Also check Alt+Left in a line of code does **not**
   move the caret by syntax.
5. In a preview follow README → setup → install, scroll setup halfway before leaving it, then
   Alt+Left twice, Alt+Right once. **Expect** setup, at the place you left it.
6. Restart throng. **Expect** both panels to keep their history and position.
7. Set *Navigation history size* to 3. **Expect** at most 3 entries, the current one kept.
8. Delete `b.ts` on disk, then step Back onto it: the editor's could-not-read banner, and Back still
   works past it.
9. Sync the preview into a sub-workspace window. Press Back in one window. **Expect** the other
   window's preview to move too.

## 6. Manual only: mouse back and forward buttons (FR-105, Open item O2)

Playwright cannot press the X-buttons, so this is checked by hand on a mouse that has them:

1. Hover an editor panel with history and press the mouse **back** button. **Expect** Back.
2. Hover a preview and press **forward**. **Expect** Forward.
3. Hover a terminal and press **back**. **Expect** nothing, and the app window does not navigate.

Record the result (Electron version, mouse model) in the PR description.

## 7. What to check in the diff

- `packages/ui/tests/e2e/e2e-budget.json`: total 569, `@editor` 117, `@window` 197 and `core` 39 —
  **unchanged**: five declarations added, five moved down (T163a–T163e), each step named in
  `measuredFrom`.
- `SHIPPED_DEFAULTS_VERSION` 7 → 8; `EXPECTED_ICON_TOKEN_COUNT` 65 → 69.
- `parallel-plan.json` lists the three focus-taking specs as serial.
- `README.md`, `docs/quick-start.md`, `CONTRIBUTING.md` (adding a provider), `docs/testing.md` (the new
  declarations, the five moved down, the manual X-button check) and `CHANGELOG.md` updated in the same
  change.

## 8. Iteration 2026-09-15 (FR-113–FR-120, the text-selection defect)

*Added by `speckit-iterate`. Tasks T181–T217. The layer commands in §1 still apply; the test files this
iteration adds or amends are the union of its Red checkpoints, T184 and T197, plus T209.*

### What to run, cheapest first

```bash
npx vitest run --project unit packages/core/tests/unit/navigation-history.test.ts \
  packages/core/tests/unit/preview-settings.test.ts packages/ui/tests/unit/editor-scroll-store.test.ts \
  packages/ui/tests/unit/markdown-pipeline.test.ts packages/ui/tests/unit/preview-text-selection-css.test.ts
npx vitest run --project component packages/ui/tests/component/preview-scroll-sync.test.ts \
  packages/ui/tests/component/preview-link-readout.test.ts packages/ui/tests/component/preview-images.test.ts
npx vitest run --project integration packages/ui/tests/integration/preview-service-navigate.integration.test.ts \
  packages/ui/tests/integration/navigation-history-service.integration.test.ts
npx playwright test packages/ui/tests/e2e/preview-scroll.e2e.ts   # serial tier; three declarations after T183
```

### Hands-on (T217) — record each result in the PR description

1. **Selecting text (Request 2).** Preview `packages/ui/tests/fixtures/preview/gfm.md`. Drag across two
   paragraphs with the mouse. **Expect** a visible selection; Ctrl+C then paste into an editor gives the
   text. Hold Ctrl and drag starting on a link: text is selected and the link is **not** followed.
2. **Scroll sync (FR-113, FR-114).** Open `long-1000.md` in an editor with its preview beside it. Scroll
   the editor to a heading about halfway. **Expect** the preview to show the same heading at its top.
   Scroll the preview: **expect** the editor to follow, its top line matching the preview's top block,
   with its caret unchanged (FR-121, Session 2026-09-16 — synchronisation is two-way). Type at the top of
   the editor without scrolling it: the preview keeps its place (FR-024) and neither side jumps or
   oscillates (FR-121g). Use Go to Line in the editor: the preview follows (FR-121f). *(Was "Scroll the
   preview: the editor does not move", the one-way rule FR-121 supersedes.)* Turn **Preferences → Editor → Previews → Synchronise preview and
   editor scrolling** off and scroll the editor: the preview stays put. Turn it on again. Sync the preview
   alone into a sub-workspace window and scroll the editor in the main window: that preview view does
   **not** follow (FR-113, same-window reading); the one in the main window does.
3. **Heading jumps (FR-115).** In a preview of `packages/ui/tests/fixtures/preview/syntax-showcase.md`
   (or any document whose table of contents links to its own headings), start at the top and Ctrl+click
   two contents links. **Expect** Back enabled; Back → the first heading; Back → the top; with the
   preview having arrived there from another file by a link, one more Back → that file. Forward retraces.
   Ctrl+click the same contents link twice in a row without scrolling: Back goes to the top, not to the
   same heading twice. In an editor, nothing changed: Back/Forward still step between files only.
4. **Copy Link Address (FR-116).** Right-click a `#heading` link → *Copy Link Address*, paste: the
   preview's own absolute path followed by `#heading`. On `docs/setup.md#install` in `links/README.md`:
   `…\docs\setup.md#install`.
5. **Front matter (FR-117).** Preview `front-matter.md`. Turn **Markdown: Show front matter** off.
   **Expect** no table, no horizontal rule, no YAML text; the document starts at its first real block.
   Scroll sync (step 2) still lands on the right heading. Turn it back on: the table returns. Turn
   **Markdown: Enabled** off: *Show front matter* is drawn disabled, not hidden.
6. **Link target readout (FR-118).** Hover a link to `https://example.com/`: the left of the preview's
   status bar reads it; move away: it clears. Tab to a link: its target shows; Tab past the last link:
   it clears. Hover a linked image: the readout names the link. Narrow the panel: the readout is clipped
   with an ellipsis and *Open in Editor* stays. Turn **Editor · Status Bar** off: no bar, and the link's
   tooltip still names its target.
7. **Browser in front (FR-119).** With the default browser already running, Ctrl+click an `https:`
   link in a preview three times, and the same URL in a terminal three times; repeat with the browser
   closed. **Expect** the browser in front of throng every time. Record Windows build, browser and the
   count out of twelve. *(Until T208's probe reports, the cause is a hypothesis — research R27.)*
8. **Image tooltips (FR-120).** Hover `![](image.png)` in `links/docs/setup.md`: the tooltip reads
   `image.png`, never a `throng-preview:` address. An image with a title in the Markdown shows both. Turn
   *Load remote images* off and hover a remote image's alternative text: the same tooltip. Hover an image
   inside a link: the link's own tooltip, not the image's.

### What to check in the diff

- `packages/ui/tests/e2e/e2e-budget.json`: total **569**, `@editor` **117**, `core` **39** — unchanged:
  one declaration added (T183), one moved down (T181), both named in `measuredFrom`.
  `reserve-tag-debt.json`: **116 → 115**.
- `SHIPPED_DEFAULTS_VERSION` unchanged; no new icon token, colour token or key binding.
- `contracts/preview-ipc.md` §1 carries the `heading` intent (applied from
  `.superpowers/sdd/tasks/iterate-preview-ipc-pending.md`).

## 9. Iteration 2026-09-16 (FR-121, FR-122, T222)

Design: [plan.md](./plan.md) *Iteration 2026-09-16*; [research.md](./research.md) R30–R33;
[data-model.md](./data-model.md) §15; [contracts/menus-and-controls.md](./contracts/menus-and-controls.md) §10.

### What to run, cheapest first

Under the `running-tests` skill, one command at a time: the unit, component and integration files named
in T227–T236; `npm run typecheck`; `npm run lint`; `npm run build` after deleting
`packages/core/tsconfig.tsbuildinfo` and `packages/core/dist` (a stale `dist` hides the new icon token and
key binding from the app while every vitest run passes); then, stating the cost first, the new
declaration in `preview-scroll.e2e.ts` and the spec T226 edited, at one worker.

### Hands-on (T253) — record each result in the PR description

Use a long Markdown file with headings, a tall code block and a table (for example
`packages/ui/tests/fixtures/preview/syntax-showcase.md`), open in an editor with its preview beside it.

1. **Two-way (FR-121, FR-121b).** Scroll the **preview** with the wheel until a heading two-thirds down
   is at its top. **Expect** the editor's top visible line is that heading's source line, and the caret,
   the selection and the focus did not move. Scroll the editor: the preview follows. Drag the preview's
   scrollbar and use Page Down in it: the editor follows each time.
2. **Every cause (FR-121f).** In the editor: Go to Line to a line far down; Find to a later match; move
   the caret past the bottom with the arrow keys; type at the bottom until the editor scrolls. **Expect**
   the preview follows each time. In the preview: Ctrl+click a contents link; press Back and Forward.
   **Expect** the editor follows each time.
3. **No oscillation (FR-121g).** Scroll the editor so its top line is inside the tall code block, then
   stop. **Expect** the preview shows the block at its top and neither side moves again. Scroll the
   preview a little **within** that block: the editor does not jump. Scroll the preview to its very end:
   the editor goes as far as it can and the preview is not pulled back.
   *(Added at converge, round 2 — review I1.)* Press Ctrl+End in the editor so the preview stops at its
   own end, short of the editor's block, then type a few characters and wait: **expect** the editor does
   not jump up after each keystroke.
4. **Top of document (FR-121e, T222).** With both at the very top of `README.md`, Ctrl+click a link to a
   file with no editor open (the pair is now apart), scroll README's **editor** to line 200, then press
   Back in the preview. **Expect** README at line 200 — the editor's line, not the top — and the editor
   did not move. Same-file route (the reading proposed under FR-121e — ruled by the controller on
   2026-09-16, **the maintainer's confirmation is asked here**; say in the PR whether it is right):
   at the top, Ctrl+click a contents link (the editor follows to the heading), press Back: the preview
   returns to the top and the editor follows it there. Turn sync off and repeat the first case:
   Back lands at the top. *(With sync on, a paired preview can only be left at the top while its editor
   is there too — FR-121f — so the case arises once the pair has been apart.)*
5. **Where a pair starts (FR-121h).** Scroll an editor to line 300 and open its preview: the preview
   opens at line 300 and the editor does not move. Restart: the pair restores with the preview at the
   editor's line. Open a standalone preview of another file, scroll it halfway, choose *Open in Editor*:
   the new editor opens at the preview's place and the preview does not move.
   *(Added at converge, round 2 — review I2.)* Repeat with a file whose source fits the editor without
   scrolling but whose preview scrolls (images or badges): after *Open in Editor*, scroll the preview and
   then type until the editor can scroll. **Expect** the pair is synchronised — each side moves the other.
6. **Which editor (FR-121a).** Follow a link from the preview to a file with no editor and scroll: the
   first editor does not move. Sync the preview into a sub-workspace window and scroll it there: no
   editor moves. A standalone preview drives nothing.
7. **The toggle, everywhere (FR-122, FR-122a–c).** With two editor/preview pairs, uncheck *Synchronise
   Scrolling* in the first editor's **body** menu. **Expect** neither pair syncs; Preferences → Editor →
   Previews shows the setting off; every sync button on both status bars is unpressed; the item is
   unchecked in all four menus of both pairs. Turn it back on from the second preview's status-bar
   button, then from a **header** menu, then from a preview body menu: each flips the same setting. Hide
   the status bar (**Editor · Status Bar** off): the menu items remain. Narrow a panel: the sync button
   stays. Turn **Markdown: Enabled** off: the button and items are still there and **enabled**. A PDF or
   other binary preview, and an editor on a `.txt` file, show neither.
8. **Chord (FR-122d).** Bind *Synchronise Scrolling* in the key binder. Press it in an editor and in a
   preview: the setting flips; the chord shows beside each menu item and in the buttons' tooltips. Press
   it in a terminal: the shell receives the key.
9. **Persistence and failure (FR-122e).** Toggle, restart: the value is kept. Make `settings.json`
   read-only, toggle from the main window and then from a sub-workspace window: **expect** one error
   notice, in the window you clicked in, and every surface still showing the stored value. Open
   Preferences, toggle from a status bar, then *Revert All* in Preferences: the setting returns to its
   value when Preferences opened (plan decision 3).
10. **Description (FR-122f).** Preferences → Editor → Previews: the description says both directions and
    names the menu item and the status-bar button.

### What to check in the diff

- `packages/ui/tests/e2e/e2e-budget.json`: total **569**, `@editor` **117**, `core` **39** — unchanged;
  one declaration added (T237), one moved down (T226), both in `measuredFrom`. `reserve-tag-debt.json`
  **115 → 114**. If T226 stopped for want of a candidate, there is **no** new declaration and both files
  are untouched.
- `SHIPPED_DEFAULTS_VERSION` **9**; `EXPECTED_ICON_TOKEN_COUNT` **70**; one new key binding, shipped `[]`.
- `contracts/preview-ipc.md`: only the `viewState: null` amendment; no new channel.
- `preview-scroll-sync.test.ts` cases (7)–(10) rewritten, each naming FR-121 as the supersession.
