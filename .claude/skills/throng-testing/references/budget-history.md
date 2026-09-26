# Per-spec E2E budget histories

Read when a spec adds or removes E2E declarations and you need the precedent for how the budget, `reserve-tag-debt.json` and `parallel-plan.json` moved last time — and where each demoted assertion went.

Part of the `throng-testing` skill; the contributor overview is [`docs/testing.md`](../../../../docs/testing.md).

## The 044 declarations, and where the five they replaced went

File previews and per-panel navigation history (spec 044) added five E2E declarations, one per
constitutional reserve entry with no cheaper test for it, plus a sixth added by the 2026-09-15
iteration for the text-selection defect (below):

| Spec | Reserve | Tier | What it proves |
| --- | --- | --- | --- |
| `preview-hostile.e2e.ts` | `@reserve:runtime` | parallel | a hostile Markdown document (inline script, remote image, `<base href>`) produces no dialog, no page error, no console error from script execution, no navigation attempt, and every renderer request stays under `dist/renderer` or `throng-preview:`; turning `loadRemoteImages` off at runtime blocks the remote-image request |
| `preview-scroll.e2e.ts` — declaration 1 | `@reserve:layout` | serial | a live update to a parented preview keeps the heading the reader was looking at in place (FR-024) — run on its own app with `editor.previews.syncScroll` seeded off, because with sync on the same update measures FR-113, not FR-024 |
| `preview-scroll.e2e.ts` — declaration 2 | `@reserve:layout` | serial | Back twice then Forward once returns a standalone preview to the place the reader left it (FR-107, US7 scenario 3), including across a file notice appearing and disappearing |
| `preview-scroll.e2e.ts` — declaration 3 *(added 2026-09-15)* | `@reserve:input` | serial | a real mouse drag across a preview's body text leaves a non-empty selection spanning both paragraphs; the same drag held with Ctrl and started on a link also selects text and follows nothing (text-selection defect, FR-035, FR-094) |
| `navigation-history-keys.e2e.ts` | `@reserve:input` | serial | a real Alt+Left in an editor goes Back to the previous file and does not move the caret by syntax (FR-105) — the two are decided at the same keydown, so only a real dispatch can show which one ran |
| `preview-subworkspace.e2e.ts` | `@reserve:window` | serial | a parented preview synced into a sub-workspace follows edits typed into the main window's editor, and Back pressed in the sub-workspace window moves both — the two views share one position (FR-022, FR-110) |

Each carries `@extended` plus `@editor` or `@window`, per the two-tag rule (`docs/testing.md`, *Two lanes*).

Five declarations came down in the same phase, narrowed to a lower layer rather than deleted
outright (FR-047):

| Deleted E2E declaration | Where its assertion lives now |
| --- | --- |
| Open In offers "New Editor" (a second panel) and disables it once the file is open | `packages/ui/tests/component/editor-open-router.test.ts` ("Open In → New Editor opens an editor") and `packages/ui/tests/component/editor-open-routing.test.ts` ("opens a NEW panel every time when the open target is "new"") |
| a persisted language this build no longer knows opens as plain text, without error, and is preserved (FR-005b) | `packages/ui/tests/unit/language-override-load.test.ts`, alongside the existing `language-precedence.test.ts`, `language-loaders.test.ts` and `language-detect.integration.test.ts` cases |
| the editor pill shows the containing folder in brackets (subfolder + root) | `packages/ui/tests/component/panel-box.test.ts` ("the editor file pill shows the containing folder") |
| the File Explorer context menu has a New Folder action | `packages/ui/tests/component/explorer-root-menu.test.ts` ("New Folder on a subfolder row creates inside THAT folder (FR-086)") |
| a value outside a declared range is refused, and the last valid one stands (T057) | `packages/ui/tests/component/preferences-number-control.test.ts` (the existing above-maximum case, plus the new "refuses a value below the declared minimum, and says so") |

`e2e-budget.json` is unchanged after the phase — five additions and five removals net to zero:
total **569**, `@editor` **117**, `@window` **197**, `core` **39**. `reserve-tag-debt.json` fell from
**121 to 116**: none of the five deleted declarations carried a `@reserve:*` tag, and each of the
five new ones does.

### Iteration 2026-09-15 — a sixth declaration, and the demotion that paid for it

The text-selection defect (Request 2, against FR-035 and FR-094 — a preview's body text could not be
selected with the mouse) added a sixth declaration to `preview-scroll.e2e.ts`, tagged
`@reserve:input`: a real `page.mouse` drag across a preview's body leaves a non-empty selection
spanning both paragraphs it crosses, and the same drag held with Ctrl, started and ended on a link,
also selects text and follows nothing (FR-094 — the link is not triggered). jsdom applies no
stylesheet and the Range API ignores `user-select`, so nothing cheaper can stand in for "a real drag
selects". Its fixture is `packages/ui/tests/fixtures/preview/text-selection/`.

**One declaration was demoted to pay for it**, and the history is worth keeping because it is the
only time this budget has moved the wrong way. The planned demotion (T181) was skipped by a ruling
for a lean finish and the budget was re-seeded **upward** instead — total 569 → **570**, `@editor`
117 → **118**. Principle V's text is *"The budget is a ratchet: it may fall and MUST NOT rise"*, and
**the build could not catch it**: `e2e-budget.test.ts` asserts equality in both directions, so a
re-seeded budget is green. It survived to converge, which found it (C1), and the ruling was
reversed.

The declaration that came down is **`editor-indicators.e2e.ts`'s "auto-save writes edits within the
debounce without Ctrl+S"** (`@extended @editor`, no `@reserve:*` tag). It launched an Electron app
with a seeded `THRONG_CONFIG_ROOT`, typed into a real CodeMirror and polled a real file, for a claim
that splits across two cheaper layers:

- **the timer fires and the renderer asks for the write** — `packages/ui/tests/component/editor-update-listener.test.ts`,
  a new four-case block, *"auto-save writes the edit without Ctrl+S (006 FR-060)"*. That file already
  owned the *arming* (a timer scheduled at the debounce) and had **no** assertion that the armed
  timer did anything, so a callback that saved nothing was green at every layer. Two of the four are
  new coverage outright: the debounce itself (two edits inside the window produce one save) and
  FR-060's unpathed clause (an untitled buffer is neither written nor put behind a save dialog the
  user did not ask for).
- **the write reaches disk correctly** — `packages/ui/tests/integration/editor-service-save.integration.test.ts`,
  which writes real files through the real `EditorService` and asserts encoding, BOM and
  line-ending preservation. Strictly more than the E2E's `readFileSync(...).toContain('AUTO')`.

It was observed red **twice, against two different breaks** to `use-editor.ts`, because one break
cannot show that four cases are all load-bearing when two of them are controls: emptying the timer
body reds the two firing cases, removing the arming guard reds the two controls, and no case is red
under both.

`e2e-budget.json` therefore reads what it read before Phase 10 and again before the new
declaration: total **569**, `@editor` **117** (`@window` **197** and `core` **39** unchanged).
`reserve-tag-debt.json` falls **116 → 115** — the new declaration names its reserve entry, and the
one that came down carried none.

The declaration found two causes, not one, and each has its own lower-layer pin:

- `theme.css` sets `user-select: none` on `body` app-wide, and nothing re-enabled it for a preview.
  `markdown.css` now does, on `.preview-markdown`; pinned by
  `packages/ui/tests/unit/preview-text-selection-css.test.ts`. With that alone, the plain drag passed
  and the Ctrl+drag on a link still selected nothing — and then followed the link.
- Chromium starts no mouse selection from a press that lands on a focusable element. Measured in
  that spec against an anchor and a span, at `tabindex` 0 and -1 alike; removing the attribute alone
  restored the selection. Every followable link is `tabindex=0` for the keyboard (FR-096b), so
  `markdown-body.tsx` lifts the attribute for the length of a primary press and restores it on
  mouseup; pinned by the "a primary press on a link lifts its tabindex" case in
  `packages/ui/tests/component/preview-links.test.ts`.

Three of the iteration's requirements are checked by hand instead of by a new E2E declaration
(`specs/044-file-previews/quickstart.md` §8, T217):

- **FR-113** (an editor's scroll drives a parented preview's) — the scroll-position store, the
  top-line helper and the wiring between them are unit- and component-tested; the real-engine
  anchor geometry those numbers land on is already `preview-scroll.e2e.ts`'s existing claim, so the
  loop as a whole (what a real editor scroll actually puts at the top of a real preview) is a manual
  check rather than a new declaration.
- **FR-115** (a followed same-document heading link records a history entry) — the history reducer,
  the service and the renderer's routing are unit-, integration- and component-tested; restoring a
  scroll anchor in a real engine is again `preview-scroll.e2e.ts`'s existing claim (declaration 2).
- **FR-119** (the handler window stays in front after a web or `mailto:` link is followed) — outside
  the page entirely, and a hosted runner has no default browser to Ctrl+click against, so it stays a
  manual check regardless.

### Mouse back/forward buttons are a manual check

Playwright has no API to press a mouse's X1/X2 (back/forward) buttons — `page.mouse` exposes only
`left` / `right` / `middle`. Per-panel navigation history's mouse-button entry point is therefore
verified by hand, against `specs/044-file-previews/quickstart.md` §6, on the editor, the preview and
the terminal, rather than by an E2E declaration.

### O7 — keystroke-to-preview-update latency, recorded but not asserted

`preview-scroll.e2e.ts` prints the time from the last keystroke in a parented editor to the paired
preview reflecting it, on `long-1000.md`, as an `[O7]` annotation: 294, 278 and 271 ms across a
three-run capture, 267 ms on the final run. No requirement in spec 044 sets an SLA for this path, so
the figure is recorded rather than adjudicated — see [performance-sla.md](performance-sla.md) for
why a number with no requirement behind it stays an annotation instead of a `toBeLessThan`.

### Iteration 2026-09-16 — two-way scroll sync and its toggle

FR-121/FR-121a–h (Session 2026-09-16) make preview↔editor scroll sync two-way; FR-122/FR-122a–f give
it a toggle — the `preview.toggleSyncScroll` command, four menu items and two status-bar buttons.
Per Phase 15 of `specs/044-file-previews/tasks.md`, almost all of it is held at unit and component:
`editor-scroll-store.test.ts`, `editor-scroll-relay.test.ts`, `scroll-sync-policy.test.ts` and
`scroll-anchor.test.ts` pin the pure decisions and the editor-side relay; `preview-scroll-sync.test.ts`
cases (7)–(10) are **rewritten, not deleted**, each keeping its old title in a comment naming FR-121
as the supersession, to assert the new two-way behaviour in place of the editor-drives-preview-only
reading they pinned before; `preview-scroll-pairing.test.ts` pins where a pair starts (FR-121e,
FR-121h); and the four menu items, the two status-bar buttons, the command and the sub-workspace
failure reporting are component-tested (`menu-sections.test.ts`, `status-strip-preview-button.test.ts`,
`preview-status-bar.test.ts`, `preview-toggle-sync-command.test.ts`,
`subworkspace-config-write-notice.test.ts`).

One new E2E declaration in `preview-scroll.e2e.ts` (T237), tagged `@reserve:layout` — *"scrolling
either side of a parented preview moves the other, a caret move moves the preview, and Synchronise
Scrolling off stops both"* — proves what no cheaper layer can, over the fixture
`fixtures/preview/sync-two-way.md` (headings far apart and one 160-line code block):

- a real mouse wheel over the preview brings *Bravo* to its top, and the real editor's top line becomes
  Bravo's source line while its Ln/Col readout does not change;
- **Go to Line** into the code block, then **Ctrl+End**, move the preview's top block to the block the
  editor's top line is in (or to the preview's own end) — analyze finding I1, a caret move drives the
  preview;
- after each of those, both scrollers' `scrollTop` read identically across five consecutive animation
  frames — no oscillation;
- *Synchronise Scrolling* switched off from the editor's status-bar button flips the preview's button
  too, and then neither Ctrl+Home in the editor nor the wheel in the preview moves the other side; the
  preview's button turns it back on.

The editor's top line is read from the gutter row under the scroller's top edge — where the relay's
`posAtCoords` reads it — and the preview's top block exactly as `topBlockLine` chooses it. jsdom lays
nothing out and fires no `scroll` event for a `scrollTop` write, so the echo marks' agreement with
Chromium's and CodeMirror's real event order is visible nowhere cheaper.

It earned its place on its first run: the editor reported line 65 for a heading on line 66. The
relay's request kept CodeMirror's default 5px `yMargin`, so the requested row landed 4.2px below the
edge (measured), the line above filled the strip, and the relay's own top-line read named that line.
The fix is `yMargin: 0` in `editor-scroll-relay.ts`, pinned first at the unit layer in
`editor-scroll-relay.test.ts` (*"puts the line AT the top edge…"*, observed red at `5`).

That declaration was paid for first (T226), by the same method as the T163/T218 demotions above.
**`quick-open.e2e.ts` "a file inside an excluded folder is never listed (AS-12, FR-006)"** is gone. It
typed `quarantined` — carried only by `.git/quarantined-object.txt` and
`node_modules/quarantined-pkg/quarantined-module.ts` — and expected no rows at the shipped settings.
Quick Open lists what `ProjectFileIndexService` pushes, and main hands that service
`explorer.excludeGlobs`, so the claim is "the shipped list, applied by a real walk, keeps both folders
out". Its coverage now lives in:

- `integration/project-file-index.integration.test.ts`, *"AS-12 — at the SHIPPED exclude globs,
  nothing under .git or node_modules is listed"*, written for the move: a real tree and a real watcher,
  the shipped setting, the deep tree's two files at their paths and one kept file beside them. Observed
  red with the `node_modules` glob removed from `DEFAULT_EXCLUDE_GLOBS` — a break no other case in that
  file can see, because each of them passes its own globs;
- `core/tests/unit/app-settings.explorer.test.ts`, which pins that the shipped setting is that list;
- `quick-open-target.e2e.ts` (SC-018), which still types the same query into a real modal at the same
  default, beside the toggle that brings both files back — so the running-app half was already asserted
  twice.

The ratchets read what they read before this iteration: `e2e-budget.json` total **569**, `@editor`
**117** (568 after the demotion, 569 after the addition), and `reserve-tag-debt.json` falls **115 → 114**
— the new declaration names its reserve entry, and the one that came down carried none.
`parallel-plan.json` is unchanged: `preview-scroll.e2e.ts` was already serial (FOCUS), and
`quick-open.e2e.ts` keeps its other declarations.

`unit/menu-icon-tokens.test.ts`'s FR-014 rule — no label in both an editor's body menu and its header
menu — now states its exceptions: with a previewable file, **Open Preview** (FR-002) and **Synchronise
Scrolling** (FR-122b, both labels) are required in both, and a fixture that offers a preview proves
nothing else is shared.

## Spec 045 — clickable file links, and a budget that did not move

Clickable file links (spec 045, #198/#394) added **zero E2E declarations**. `e2e-budget.json` reads
`"total": 570` and `"@terminal": 107` before the feature and after it, `reserve-tag-debt.json` is
unchanged, and `parallel-plan.json` gained no entry because the feature created no spec file.

That was a decision made in planning rather than an outcome noticed at the end, and it is worth
stating why it held. Almost everything this feature does is decidable without a running app: the
grammar of a path, which of four targets a link has, what the default action resolves to, what the
menu offers, what a switch gates and what a terminal is spawned with are all pure functions in
`@throng/core` with unit tests, and the renderer's halves are component tests against the real
builders. The main-process authority — re-resolve, re-check, act, de-elevate — is covered by contract
and integration tests over a real filesystem and a real shell. What was left is the handful of
claims that need a real xterm, a real ConPTY and a real pointer, and **declarations that already
existed were the right home for them**:

| Declaration | What 045 added to it |
|---|---|
| `terminal-link-once.e2e.ts` — *"Ctrl+clicking a link in a program that OWNS THE MOUSE opens it once, not also through the program (#198)"* (`@extended @terminal @reserve:pty`) | two cases under the same mouse-owning fixture — a **detected path**, and an **OSC 8 `file:` target naming a folder**. Each asserts one Ctrl+click opens exactly once, that the program receives no press, and that a **plain** click still reaches the program (FR-043, SC-002, SC-005) |
| `terminal-link-once.e2e.ts` — *"Ctrl+clicking a PLAIN-TEXT url opens exactly once"* (`@extended @terminal @reserve:pty`) | a web url, a detected path and an OSC 8 hyperlink, each wrapped by a narrowed window: a Ctrl+click on the **second** row opens each exactly once (FR-130, SC-017, T186) |
| `terminal-links.e2e.ts` — *"a renderer-opened window is denied and http(s) routed to the OS opener (#159); a detected path is marked and a look-alike is not, a wrapped link is marked on every row and a dead hyperlink on none (045)"* (`@extended @terminal`) | a path that names a real file is marked and a look-alike is not (FR-006, FR-042, SC-003); the three link kinds, wrapped, carry the same at-rest mark on every row (FR-130, FR-136, T186); the corpus's four dead OSC 8 hyperlinks carry no mark, no computed underline and no hand, at rest, hovered and with Ctrl held (FR-154, T213) |

The mark is throng's own xterm decoration (`link-marks.ts`), not a style on the cells, so these read
it by geometry — `linkMarkedText()` in `harness.ts`. xterm's inline hover underline and its
`xterm-underline-5` class on OSC 8 cells are switched off in a terminal panel, and the class cannot be
removed through xterm's API, so a dead hyperlink is asserted on its **computed**
`text-decoration-line`, never on the class. `terminal-wrapped-link.e2e.ts` (#326) was skipped until
the marks landed; it now runs, measuring the hover mark on every row of a wrapped OSC 8 link.

**A case inside an existing declaration does not move the ratchet**, because the counter is a
per-line regex over `test(` declarations — so the right question for each new claim was not "does
this need an E2E" but "does an E2E that already launches this app, this shell and this fixture
exist". Every time one did, and the marginal cost of the assertion was a few hundred milliseconds
rather than another Electron launch.

**One thing only the E2E layer could have caught, and did.** xterm's `OscLinkProvider` discards an
OSC 8 target that is not `http(s)` before it builds a range unless the link handler sets
`allowNonHttpProtocols`. Without that option the whole of the `file:`-hyperlink story was inert in
the running app — no underline, no tooltip, a Ctrl+click that did nothing — while every unit and
component test around it passed, because **nothing below E2E constructs an xterm `Terminal`**. That
is the shape of claim this layer is for.

## Spec 046 — side panes and project list, and the two declarations that pay for two

Side panes, project cycling and categories (spec 046, #331/#332/#390/#411/#292) add two E2E
declarations. Both are paid for by two declarations that came down in the same spec, so
`e2e-budget.json` reads what it read going in: **total 573**, `core` 39.

| Declaration | Tags | What it proves |
| --- | --- | --- |
| `window-chord-resolution.e2e.ts` — *"from a focused real terminal, Ctrl+Shift+Alt+Numpad0, Ctrl+Shift+Alt+M and Ctrl+Shift+Alt+PageDown reach the app and the shell receives nothing (046 T049, re-pointed T164/FR-114, T181/FR-117)"* | `@extended @window @reserve:input` | from a focused **real terminal**, a real Ctrl+Shift+Alt+Numpad0 resets a zoomed window, a real Ctrl+Shift+Alt+PageDown switches project and a real Ctrl+Shift+Alt+M focuses the File Explorer, and the terminal view's own write log shows no bytes sent to the shell for any of them. (Written against Ctrl+Shift+0, Ctrl+Alt+F and Ctrl+Alt+PageDown; iterate rounds 1 and 2 moved all three, and round 3 moved File Explorer focus from Ctrl+Shift+Alt+F to Ctrl+Shift+Alt+M, below.) Only a real engine reports `e.code` for a physical key, and Principle V names a layout-dependent chord as what a synthesised event cannot prove — `window-zoom-reset-shift.test.ts` holds the dispatch over a synthesised event and cannot say what the engine reports. |
| `terminal-no-orphans.e2e.ts` — *"Unload Project and End Terminals reaps a busy terminal, and Unload Project keeps an idle shell alive, through the row menu"* (T065, rewritten in place by T129) | `@extended @terminal @reserve:process` | **Unload Project and End Terminals** on a busy shell, with no dialog (FR-111), returns the daemon's conhost count to baseline; once the project is selected again and its new shell is idle, plain **Unload Project** (the shipped `keepRunning` default) keeps that idle shell alive (FR-086, Principle III) — the same `cmd.exe` pid and the same ConPTY host are still under the daemon after the project is selected again, so the panel reattached rather than respawning; both go through the project row's context menu. An extra case from the T048b demotion below rides on the same launch at no extra declaration: after the Unload the row's `.project-item__name` computes `italic`, and `normal` again once the project is selected — the painted half of `loaded-projects.e2e.ts`'s old claim, which no lower layer can read (`getComputedStyle` tells nothing at component level). |

Two declarations came down to pay for them, each moved to a layer that already holds the claim
rather than deleted outright:

| Removed E2E declaration | Where its assertion lives now |
| --- | --- |
| `pane-shortcuts.e2e.ts` — *"Ctrl+Alt+B toggles the Projects pane and Ctrl+Alt+N toggles the File Explorer pane"* | A duplicate of `window-chord-resolution.e2e.ts`'s *"the pane toggles still resolve — Ctrl+Alt+B and Ctrl+Alt+N"* (retitled for Ctrl+Shift+Alt+B / N by T142, and to *"the pane toggles still resolve — Ctrl+Shift+Alt+J and Ctrl+Shift+Alt+K"* by T181) — the same presses (the survivor reads the chords through `chordFor()` rather than spelling them literally), the same `pane-hide-*` / `pane-rail-*` assertions, and the declaration `window-chords.ts`'s `COVERED` map already named for both toggles. Removing it is a de-duplication, not a demotion: no lower layer mounts `app.tsx`'s pane rails, so the surviving E2E is still what holds the claim. |
| `loaded-projects.e2e.ts` — *"indicates loaded vs not-loaded projects"* (the file's only declaration) | `packages/ui/tests/component/projects-panel-loaded-style.test.ts`, mounting `ProjectsPanel` over one persisted project and a fresh store — exactly what a restart gives, since loaded state is session-only. It asserts `data-loaded`, the `--unloaded` modifier, the unsaved dot and the loaded marker; the *painted* italic style it also carried is not claimed here (Principle V — the component layer cannot tell how an element was painted) and moves instead into the `terminal-no-orphans.e2e.ts` case above. |

`e2e-budget.json`'s `byCategory` moves `@window` down by one net (one declaration removed from
`pane-shortcuts.e2e.ts`, one added to `window-chord-resolution.e2e.ts`, one more removed from
`loaded-projects.e2e.ts`) and `@terminal` up by one (`terminal-no-orphans.e2e.ts`'s new
declaration) — the ratchet moves on both sides of the ledger and lands at the same total.
`parallel-plan.json` is unchanged: both surviving files were already in the serial tier, and
neither new declaration steals focus or drives a long-running shell in a way the parallel tier
would starve.

### Iterate round 1 — the presses move, the budget does not

046's first iterate round moved the navigation and window defaults to `Ctrl+Shift+Alt` (FR-101 –
FR-105), gave `Ctrl+Wheel` / `Ctrl+MiddleClick` to the panel zoom (FR-106), put word wrap on the
two-stroke `Ctrl+E W` (FR-091) and made Unload prompt-free (FR-111). **No E2E declaration is added
or removed**: every change is to what an existing declaration presses or asserts, with its tags
unchanged, so `e2e-budget.json` still reads **total 573**, `core` 39, and `parallel-plan.json` is
untouched.

Where a spec presses a shipped default it now reads it — `shippedPress(action)` /
`shippedPresses(action)` in `packages/ui/tests/shared/window-chords.ts`, which run the first shipped
binding through `toPlaywrightPresses` — so a default that moves again is pressed as moved rather than
failing on a stale literal. The one deliberate literal is `notice-focus-chord.e2e.ts`, because
`window-chord-manifest.test.ts` checks its `COVERED_ELSEWHERE` exemption by finding the keystroke
spelled in the code.

- **`window-chord-resolution.e2e.ts`** presses the tier-1 chords: the pane toggles
  (`Control+Shift+Alt+J` / `K`; `B` / `N` until round 3), the tab picker (`Control+Shift+Alt+T`),
  project cycling (`Control+Shift+Alt+PageDown`), File Explorer focus (`Control+Shift+Alt+M`; `F`
  until round 3) and the window zoom
  reset on the keypad (`Control+Shift+Alt+Numpad0`, FR-114 — round 2 took the main-row `0` off both
  resets). The last three are still pressed from a focused **real terminal** whose write log must
  stay empty — the `@reserve:input` case — because only a real engine reports `e.code` for a
  physical key held with Ctrl, Shift and Alt. The three declarations that name a chord in their
  title were retitled to match.
- **The other re-pointed presses** (T142): `notice-focus-chord.e2e.ts` (`Control+Shift+Alt+M`, and
  the `COVERED_ELSEWHERE` entry with it; `Control+Shift+Alt+V` since T181); `tab-picker.e2e.ts`, `transient-overlays.e2e.ts` and
  `tab-scroll.e2e.ts` (`Control+Shift+Alt+T`); `pane-shortcuts.e2e.ts` (the replaced shipped
  `Control+Shift+Alt+B` no longer toggling); `move-focus.e2e.ts` (`Control+Shift+Alt+ArrowRight` /
  `ArrowLeft`); `editor-word-wrap.e2e.ts` and `status-bar-visibility.e2e.ts` (two presses,
  `Control+e` then `w`, with `editor-pending-chord` asserted visible between them so the second
  stroke is never sent blind — lowercase because `press('W')` sends a `key: 'W'` with no Shift, which
  no keyboard produces and CodeMirror does not match as the bare `w` stroke; measured, the chord
  went pending and then reported itself not bound); `panel-zoom.e2e.ts` (the panel reset as `Control+Alt+Numpad0`);
  `tab-settings.e2e.ts` (the Key Bindings row shows, and a capture keeps, the shipped
  `Ctrl+Shift+Alt+T`); and `preferences-reset.e2e.ts`, whose remove-then-reset cases now use
  `panel.zoomIn` / `panel.zoomOut` — actions that still ship a chord plus a gesture — because
  FR-105 left `zoom.in` and `zoom.out` a single chord each, with nothing left to restore around.
- **`terminal-no-orphans.e2e.ts`**'s Unload declaration changes what it asserts (T129); its row in
  the table above records that.

**Iterate round 3 (T181, FR-117)** moved the letters again: the three focus commands to
`Ctrl+Shift+Alt+B` / `N` / `M` (Projects, the new **Focus Workspace**, File Explorer), the pane
toggles to `J` / `K` and `focus.notice` to `V`, leaving `F` and `P` unbound. It too adds and removes
no declaration and changes no tag, so the budget still reads **total 573**, `core` 39. Two titles
changed (the pane-toggle declaration and the real-terminal one, both quoted above), one literal
press changed (`notice-focus-chord.e2e.ts`, now `Control+Shift+Alt+V`), and `pane-shortcuts.e2e.ts`
changed only in its comments; every other press goes through `chordFor()` / `shippedPress()` and
followed the defaults on its own. `focus.workspace` is proven at the component layer
(`side-pane-focus-commands.test.ts`, claimed by `window-chords.ts`'s `COVERED_IN_COMPONENT`), the
lowest layer that mounts both side panes, the workspace and the real `KeybindingsHandler` together,
so it needs no E2E.

What stayed below E2E: the physical-key mapping across US, UK, German, French and Polish `key`
values, the keypad same-binding rule, the two-stroke engine's endings, the capture modal's
two-stroke control, the gesture routing to the panel under the pointer, and the v13 and v14
saved-bindings upgrades (each with its idempotent re-run) are all unit, component or integration tests — none of them
needs a window, and a synthesised event is exactly what they are about. The one claim a synthesised
event cannot settle, whether Chromium reports `AltGraph` for the right-hand AltGr key (FR-104), is
not an E2E either: Playwright's key events carry whatever modifier state the test sets, so it is a
maintainer's hand check (T149).
