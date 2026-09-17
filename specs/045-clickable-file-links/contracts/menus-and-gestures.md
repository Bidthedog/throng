# Contract: menus, gestures and the chord

**Feature**: 045 | **Requirements**: FR-030 – FR-034, FR-040 – FR-046, FR-050 – FR-055, FR-062

Section vocabulary and guarantees are [033's](../../033-open-and-navigate/contracts/menu-sections.md).
`section` is a **required** field on `MenuAction` (`ui/src/renderer/workspace/context-menu.tsx:31,48`),
so an item that declares none is a compile error. `menu-sections.test.ts` gains a `shapeOf` pin per
menu below.

Notation: **[D]** drawn disabled when…, **[A]** absent when…, *(chord)* shows the bound chord.

---

## §1 The file-link run — identical in both panel types (FR-031)

Over a file link, with **no text selected**, the menu **leads** with a `contextual` section:

| Order | Item | State |
|---|---|---|
| 1 | **Open Link** | always; runs the default link action (FR-050); shows the chord **only where one is bound** — see §4 |
| 2 | **Open in Editor** | [A] target is a folder, or outside the project |
| 3 | **Open in Preview** | [A] no provider accepts the type, folder, or outside the project · **[D]** the provider is disabled (044 FR-062) |
| 4 | **Open in OS Explorer** | always |
| 5 | **Open in OS Default Program** | [A] target is a folder |
| 6 | **Copy Link Address** | always |

Items 2–5 are `linkTargetStates(link)` in FR-030's order
([../data-model.md](../data-model.md) §3). Each performs its own target whatever the preference says
(FR-054). Only **Open in Preview** can be disabled; every other absence is structurally meaningless
for that link, which is Principle VI's *absent when meaningless*.

**Where the run is inserted:**

| Panel | Builder | Insertion |
|---|---|---|
| Terminal | `ui/src/renderer/terminal/terminal-content-menu.ts:49` (`terminalContentMenu`) | replaces the existing `contextual` Open Link / Copy Link Address pair (`:54-70`) **only over a file link**; over a web link that pair is unchanged |
| Editor | `ui/src/renderer/editor/content-menu.ts:86` (`editorContentMenu`) | a new `contextual` run, ahead of the existing `content` section — the first contextual items this menu has had |

**Unchanged in every other case** (FR-031): with text selected, the ordinary menu appears
(024 FR-019d); away from a link, the menu is byte-for-byte what it is today; over a **web** link in a
terminal, 024's two items are what they are today.

---

## §2 What each item does

| Item | Route | Rules |
|---|---|---|
| **Open Link** | `resolveDefaultLinkAction(...)` then the row below it names | FR-050 – FR-054; FR-039 removes `osDefaultProgram` from reach for an executable |
| **Open in Editor** | `openFileInTab(ws, tabId, absPath, openTarget, positionRevealTarget(...))` — **never** `open-router.ts` | FR-033; honours *Open files in* (023 FR-025/FR-026); always an editor whatever the file's default open action (044 FR-055) |
| **Open in Preview** | `requestPreviewOpen({ absPath, projectId, requesterPanelId })` | FR-034; beside the file's editor, focusing an existing preview (044 FR-005/FR-053); **a position on the link is ignored** |
| **Open in OS Explorer** | `throng:links:reveal` → `FileLinkResolver.revealInFileManager` | FR-035; file → selected in its folder, folder → opened; de-elevated when the host is elevated (FR-038) |
| **Open in OS Default Program** | `throng:links:open` → `FileLinkResolver.openWithDefaultProgram` | FR-036; a failure raises **one** notice naming the file and the reason (030); de-elevated (FR-038) |
| **Copy Link Address** | clipboard, plain text | FR-032: the **resolved** absolute path, plus the position **in the form it was written** when the link has one. Copies a resolved path for a target outside the project too — which is where this differs from 044 FR-116 |

**The renderer never hands main a bare path.** Both OS routes send the `LinkResolutionRequest`; main
re-resolves it, re-checks existence, and acts (FR-037). That is also why neither reuses
`throng:files:reveal` (root-relative, project-confined) or `throng:files:revealDocument`
(confined to files a panel has open) — neither policy admits a link to a file outside the project
that nothing has open, which FR-030 requires.

---

## §3 Gestures

| # | Gesture | Surface | Behaviour | FR |
|---|---|---|---|---|
| G1 | **Ctrl+click** (Cmd on macOS) over a file link | terminal, editor | runs the default link action | FR-040 |
| G2 | **Plain click** | both | its ordinary meaning on that surface; nothing opens | FR-040 |
| G3 | **Ctrl+click that drags** | both | a selection, not an activation | FR-040, Principle VI |
| G4 | **Ctrl+click anywhere but a link**, in an editor | editor | CodeMirror's own add-a-cursor, unchanged | FR-041 |
| G5 | **Ctrl+click on a link, under a mouse-reporting program** | terminal | opens **once**; the press does not reach the program | FR-043 |
| G6 | **Ctrl+click not on a link, under a mouse-reporting program** | terminal | reaches the program, so links it draws itself keep working | FR-043 |
| G7 | **Hover** | both | underline + a tooltip naming the gesture; in a terminal after `terminals.linkHoverDelayMs` | FR-042 |
| G8 | **Open Link chord**, single caret inside a link, no selection | editor, preview | runs the default link action | FR-044, FR-045 |
| G9 | **Open Link chord**, anywhere else / multiple carets / a selection | editor | the editor's built-in blank-line insert, unchanged | FR-044, edge case |
| G10 | **Ctrl+Enter** | terminal | reaches the program, including its modified-Enter encoding | FR-046 |

**G5/G6 are inherited, not built.** `keepLinkClickFromProgram`
(`ui/src/renderer/terminal/use-terminal.ts:838-861`) already implements exactly this, gated on
`hoveredLink !== null`. Widening what sets `hoveredLink` ([../data-model.md](../data-model.md) §8)
is the whole change. Its covering test is `ui/tests/e2e/terminal-link-once.e2e.ts:529`.

**G4 requires claiming the event first**: a `mousedown` entry in `EditorView.domEventHandlers` that
returns `true` **only** when the modifier is held and `view.posAtCoords` lands inside a resolved
link. Otherwise CodeMirror's own multi-cursor handler runs, which is G4.

**G9's "unchanged" is a consequence of dispatching at the window**: when no link holds the caret the
window handler does not `preventDefault`, so the keypress reaches CodeMirror's `defaultKeymap`
(`use-editor.ts:1232`) exactly as it does today. See research R9.

---

## §4 The chord

One rebindable command: **`preview.followLink`**, default `Ctrl+Enter`, scope `editor` + `preview`
(FR-045). Not live in a terminal (FR-046). The ActionId is **not renamed** — a rename would silently
drop every rebinding a user has saved since 044.

| Surface | Chord on its Open Link item |
|---|---|
| Editor | shown |
| Preview | shown (044, unchanged) |
| **Terminal** | **not shown** |

The terminal row omits it because no chord is bound in that scope, and Principle VI requires a menu
item to show its chord *"where one is bound"*. Drawing `Ctrl+Enter` there would advertise a key that
reaches the shell. This is the reading that reconciles FR-031 with FR-046; see research R10(b).

**FR-062**: the key-binding descriptor's description stops saying *"Live in a preview only."*, so
the Key Bindings editor lists the command for editors as well. The Scope column is derived from
`COMMAND_SCOPES` by `chord()` (`keybindings-metadata.ts:17-19`) and needs no separate edit — but it
is read from `packages/core/dist`, so a stale `dist` will make an E2E disagree with a unit test
(CLAUDE.md's recorded trap).

---

## §5 The keyboard-opened menu (`menu.open`, Shift+F10)

US4 scenario 8 requires the keyboard-opened menu over a terminal file link to offer the same items.
It does, by the **same mechanism 024 already uses**: the terminal's menu composes from
`getHoveredLink()`, which is what the pointer rests on, and `menu.open` does not move it. There is no
new notion of a keyboard position on a terminal link — FR-046 forbids one.

In the editor, `placeCaretForContextMenu` (`content-menu.ts:235`) already no-ops for a keyboard menu
(`isKeyboardMenu()`); the link run therefore composes from the **caret's** position for a keyboard
menu and from `posAtCoords` for a right-click. Both are a single document offset, so one hit-test
serves.

---

## §6 The detection switches (FR-060)

| Off | What stops | What keeps working |
|---|---|---|
| `editor.links.detectInTerminals` | detected paths in terminals: underline, Ctrl+click, menu items | **web links**, **explicit `file:` hyperlinks**, the whole 024 US7 surface |
| `editor.links.detectInEditors` | the same in editors; Ctrl+click and Ctrl+Enter keep their ordinary editor meanings everywhere | — |

Live, with no restart: the terminal switch gates the link provider's `provideLinks`, and the editor
switch reconfigures a compartment — the pattern `wrapCompartment` and `functionHighlightCompartment`
already use (`use-editor.ts:462-466`, `:939-952`).

A switch **never** touches an explicit hyperlink: the program chose to emit it and throng did not
guess it, so it follows the same rule as a web link.
