# Contract: menus, gestures and the chord

**Feature**: 045 | **Requirements**: FR-030 – FR-034, FR-040 – FR-046, FR-050 – FR-055, FR-062;
*amended 2026-09-18*: FR-100 – FR-105, FR-110 – FR-114, FR-124 — see §7. Wherever this contract says
"runs the default link action", read **runs the click rule** (FR-110); the setting is retired.
*Second round*: FR-130 – FR-139 — §7.6. *Third round*: FR-150, FR-151, FR-154 and D3 — §8.
*Round four, 2026-09-19 (maintainer)*: wherever this contract says **Copy Link Address**, read **Copy
Link to Clipboard** (spec FR-175, S7; constitution v5.5.2). The rest of round four (FR-155 – FR-177,
the Link menu) is for `/speckit-plan` to design here; this line changes the label only.

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
| Terminal | `ui/src/renderer/terminal/terminal-content-menu.ts` (`terminalContentMenu`) | replaces the existing `contextual` Open Link / Copy Link Address pair **only over a file link**; over a web link that pair is unchanged |
| Editor | `ui/src/renderer/editor/content-menu.ts` (`editorContentMenu`) | a new `contextual` run, ahead of the existing `content` section — the first contextual items this menu has had |

**One builder, verified 2026-09-18 (T130).** Both surfaces call `fileLinkMenuActions`
(`ui/src/renderer/links/link-menu-items.ts`), which maps core's `fileLinkMenuItems` onto `MenuAction`
rows. The renderer half attaches only the icons, the section and the handlers; the labels, the order,
the absences and the one disabled state are decided in `core/src/links/menu.ts` and are unit-tested
clause by clause. Icons follow 023's rule — a token or nothing: `editorPanel`, `preview`,
`folderOpen` and `copy` exist; *Open Link* and *Open in OS Default Program* carry none.

**A disabled row carries no handler at all** — not a handler guarded by the disabled flag. The menu
will not invoke one, and leaving it out means there is nothing for a later caller to reach past the
disabled state and run.

**The terminal suppresses the whole run while text is selected**, before it is composed
(`selection.length > 0`), which is the same rule as the *Unchanged in every other case* paragraph
below rather than a second one: with a selection the ordinary Copy/Paste menu appears whatever the
pointer is over (024 FR-019d).

**Unchanged in every other case** (FR-031): with text selected, the ordinary menu appears
(024 FR-019d); away from a link, the menu is byte-for-byte what it is today; over a **web** link in a
terminal, 024's two items are what they are today.

---

## §2 What each item does

| Item | Route | Rules |
|---|---|---|
| **Open Link** | the surface's own `openLink` — `followLink(...)`, which calls `resolveDefaultLinkAction(...)` and then the row below it names | FR-050 – FR-054; FR-039 removes `osDefaultProgram` from reach for an executable |
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

*G7 superseded 2026-09-20 (round five) by §10.2: the underline stands, at FR-184's prominence; the
tooltip is a native HTML `title` carrying the target, with no wording and no delay, and
`terminals.linkHoverDelayMs` is retired (FR-169a, FR-169b).*

**G5/G6 are inherited, not built.** The rule already existed in `use-terminal.ts`'s mousedown
listener, gated on `hoveredLink !== null`. Widening what sets `hoveredLink`
([../data-model.md](../data-model.md) §8) is the whole change. It ships as the pure
`keepsClickFromProgram` (`ui/src/renderer/terminal/hovered-link.ts`) — reconciled 2026-09-18 (T130):
the predicate moved out of the effect with the type, so it can be driven without an xterm; the
listener now calls it rather than restating it. Its covering test is
`ui/tests/e2e/terminal-link-once.e2e.ts`.

**Open Link is the surface's route, passed in.** `FileLinkMenuContext` carries `openLink` —
the same `followLink` call the surface's Ctrl+click makes — rather than letting the menu resolve the
preference for itself, so the two can never disagree (FR-054). It also carries `position` and
`positionText`, which items 2 and 6 need and which the resolved path does not hold; see
[../data-model.md](../data-model.md) §8.

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

In the editor, `placeCaretForContextMenu` already no-ops for a keyboard menu (`isKeyboardMenu()`);
the link run therefore composes from the **caret's** position for a keyboard menu and from
`posAtCoords` for a right-click. Both are a single document offset, so one hit-test serves.

**Reconciled 2026-09-18 (T130)**: that choice ships as one exported function,
`linkMenuPosition(view, event)` in `content-menu.ts` — `isKeyboardMenu()` ? `selection.main.head` :
`view.posAtCoords(...)`. It is a function rather than an inline branch at the call site because the
trap it avoids is the one `placeCaretForContextMenu` was already fixed for: a keyboard menu's
synthetic event carries the focused element's corner, which is nowhere near the caret, so a
right-click's hit test silently composes the wrong menu for Shift+F10.

---

## §6 The detection switches (FR-060)

> **Superseded 2026-09-20 (round five, maintainer M13) by §10.1 / FR-180.** The "What keeps working"
> column below is withdrawn: a switch that is off leaves **nothing** working in that panel type. The
> "What stops" column, the live-reload mechanism and the labels' home are unchanged — the labels
> themselves lose the word *file*. The table is kept as it was.

| Off | What stops | What keeps working |
|---|---|---|
| `editor.links.detectInTerminals` | detected paths in terminals: underline, Ctrl+click, menu items | **web links**, **explicit `file:` hyperlinks**, the whole 024 US7 surface |
| `editor.links.detectInEditors` | the same in editors; Ctrl+click and Ctrl+Enter keep their ordinary editor meanings everywhere | — |

Live, with no restart: the terminal switch gates the link provider's `provideLinks`, and the editor
switch reconfigures a compartment — the pattern `wrapCompartment` and `functionHighlightCompartment`
already use (`use-editor.ts:462-466`, `:939-952`).

A switch **never** touches an explicit hyperlink: the program chose to emit it and throng did not
guess it, so it follows the same rule as a web link.

*2026-09-18*: neither switch touches a **web link in an editor** either (FR-101) — the editor switch
governs detected paths only, exactly as the terminal switch does.

---

## §7 Amendment 2026-09-18 — one link model, and the click rule

### §7.1 What Open Link, Ctrl+click and the chord do (FR-110, FR-111)

`resolveDefaultLinkAction` keeps its name — renaming it would churn every caller for no behaviour —
and loses its `setting` argument and its fallback:

| Resolved link | Result | Route (unchanged from §2) |
|---|---|---|
| file, in project, `previewIsDefault` and no position | `preview` | Open in Preview |
| file, in project, otherwise | `editor` | Open in Editor, at the position |
| file, outside the project | `osExplorer` | Open in OS Explorer, file selected |
| folder, anywhere | `osExplorer` | Open in OS Explorer, folder open |

Its return type is `'editor' | 'preview' | 'osExplorer'`. **`osDefaultProgram` cannot be returned**,
so no caller of the click rule can reach `throng:links:open` — FR-111 is enforced by the compiler.
The **named** item *Open in OS Default Program* (§1 row 5) is unchanged and is the only caller of
that channel. An executable is not special-cased (FR-114): in the project it opens as text; outside
it is revealed like every other file.

### §7.2 The web-link run in an editor (FR-103, S4)

Over a web link, with **no text selected**, the editor's content menu leads with a `contextual`
section:

| Order | Item | State |
|---|---|---|
| 1 | **Open Link** | always; opens the address in the system browser via the open-external seam; shows `Ctrl+Enter` (the chord is bound in the editor scope, §4) |
| 2 | **Copy Link Address** | always; copies the address exactly as written |

This is the terminal's existing web-link pair (024 FR-019d), built by **one** builder —
`webLinkMenuActions` in `ui/src/renderer/links/link-menu-items.ts` — which the terminal's
`terminalContentMenu` now calls too. The terminal's run is unchanged item for item, and **without**
a chord (§4). With a selection, the ordinary menu wins in both panels. `menu-sections.test.ts`
gains a `shapeOf` pin for the editor menu over a web link.

### §7.3 Gestures added for web links in an editor

| # | Gesture | Surface | Behaviour | FR |
|---|---|---|---|---|
| G11 | **Ctrl+click** over a web link | editor | opens it once in the system browser, `http`/`https` only | FR-103 |
| G12 | **Plain click** over a web link | editor | places the caret; nothing opens | FR-103 |
| G13 | **Open Link chord**, single caret inside a web link, no selection | editor | opens it, as G11 | FR-103, FR-044 |
| G14 | **Ctrl+click that drags**, from a web link | editor | selects | FR-103 |

G4 (Ctrl+click off a link adds a cursor) and G9 (the chord off a link inserts a line) are unchanged
and now apply with web links present too: the `mousedown` handler claims the press only over a
**resolved file link or a web span**, and the window chord handler only when the caret is inside
one.

### §7.4 The tooltip (FR-105)

One function, `linkHoverText(kind, clickResult, chord)` in `core/src/links/hover-text.ts`, which the
terminal's `hoveredLinkTipText` and the editor's link tooltip both call:

| Link | Text |
|---|---|
| web | `Ctrl+Click to open in system browser` (024's wording, unchanged) |
| file whose click is `editor` or `preview` | `Ctrl+Click to open` |
| file or folder whose click is `osExplorer` | `Ctrl+Click to show in OS Explorer` |

`Cmd` replaces `Ctrl` on macOS, as today.

### §7.5 The failure notice gains a reason (FR-124)

### §7.6 One affordance, marked at rest (second round — FR-135 – FR-139)

| State | Editor | Terminal |
|---|---|---|
| at rest | CodeMirror mark: `text-decoration: underline dashed var(--throng-colour-linkUnderline)`; **no** `color` | an xterm decoration over every row of the link, same style |
| hovered | underline `solid var(--throng-colour-linkUnderlineHover)` over the whole link | the same, over **every** row (FR-131) |
| hovered + modifier | `cursor: pointer` | `cursor: pointer` |
| tooltip | §7.4's `linkHoverText`, after the delay | the same, after `terminals.linkHoverDelayMs` |

Every link kind takes the same row — web, detected path, `file:` text, OSC 8. xterm's own OSC 8
underline is restyled or replaced per open item O10. Both tokens are in the **General** area with
inheritance parents (`linkUnderline` → `accent`; `linkUnderlineHover` → `linkUnderline`). This
supersedes the editor's shipped `color: var(--throng-colour-accent)` on `.cm-throng-link`.

*§7.6 amended 2026-09-20 (round five): the **at rest** row's colour becomes
`color-mix(in srgb, var(--throng-colour-linkUnderline) 45%, transparent)` in both panel types, and the
Markdown preview — a third surface this table predates — uses `border` at rest and `syntaxFunction` on
hover, because its stylesheet may name neither that token nor a colour function (FR-184, FR-184a). The
**hovered + modifier** row is FR-164's (any hover). The **tooltip** row is withdrawn: there is no
tooltip of throng's and no delay (FR-169a, FR-169b; §10.2).*

G15 *(second round)* — **Ctrl+click on any row of a wrapped link** (terminal): follows the whole
target once (FR-131, FR-043).

`LinkActionOutcome`'s failure reasons become `'gone' | 'refused' | 'unreachable'`. `unreachable`
raises **one** notice naming the path and saying the location did not answer; `gone` keeps saying it
no longer exists. The notice route is §2's, unchanged.

*Note 2026-09-18 (third round):* the paragraph above belongs under §7.5's heading, which is empty; it
was placed after §7.6 by an earlier edit. It is left where it is (nothing is moved or deleted) and
this note is the pointer.

---

## §8 Amendment 2026-09-18, third round — dead hyperlinks, the first character, and one more tooltip case

### §8.1 §7.6's "every link kind takes the same row" means every **followable** link (FR-154)

§7.6 says every link kind, "OSC 8" included, takes the affordance row. Read literally it would draw
the affordance over an OSC 8 hyperlink whose target goes nowhere — which is what the corpus probe
found shipped (rows 13 – 15: underline and hand pointer, then nothing). Stated precisely:

| OSC 8 target | Affordance | Tooltip | Ctrl+click | Menu |
|---|---|---|---|---|
| `http` / `https` | §7.6, marked as drawn | web wording | open-external, once | web-link run |
| `file:` that has resolved | §7.6, marked once resolved (hover or idle scan) | §7.4 by click result | the click rule | file-link run (§1) |
| `file:` not yet resolved, not found, or `unreachable` | **none** — xterm's own underline suppressed too | **none** | reaches a mouse-reporting program (G6) | the ordinary menu |
| any other scheme, or empty | **none** | **none** | as above | the ordinary menu |

No notice is raised for either "none" row; the reasoning is in
[link-resolution.md](./link-resolution.md) §8.4. A `file:` target that later resolves gains its mark
with no pointer movement (FR-123).

| # | Gesture | Surface | Behaviour | FR |
|---|---|---|---|---|
| G16 | **Hover** over a dead OSC 8 hyperlink | terminal | nothing: no underline, no pointer, no tooltip | FR-154 |
| G17 | **Ctrl+click** on a dead OSC 8 hyperlink under a mouse-reporting program | terminal | reaches the program; throng opens nothing and reports nothing | FR-154, FR-043 |

### §8.2 G1 at a link's first character (D3)

G1 applies to **every** character of a link's span, the first included: the `mousedown` handler's
hit-test and the decoration MUST agree on where a span starts, so a Ctrl+click on the character under
which the hover draws a link and a hand pointer is always a follow and never CodeMirror's
add-a-cursor (G4). The probe saw this fail 2 of 27 times at column 1 in an editor (D3). The cause is
a hypothesis until T215 reproduces it; this clause states only what must hold.

### §8.3 The tooltip over a spaced or Git Bash path (FR-150, FR-151)

No new wording. §7.4's table applies to the **resolved** link: a path with spaces whose longest
existing reading is in the project says `Ctrl+Click to open`; `/usr/bin/bash.exe` resolved through
Git's mount table is outside every project and says `Ctrl+Click to show in OS Explorer`. The
underline and the tooltip cover the span of the reading that resolved (link-resolution §8.1), never
the words after it.

---

## §9 Amendment 2026-09-19, round four — the hint, the pointer, the readout, the Link menu

§1's file-link run, §7.2's web-link run and §7.4's tooltip table are **superseded** by §9.1 – §9.4 for
the cases named. Nothing above is rewritten.

### §9.1 The Link menu (FR-169 – FR-171, FR-175)

Opened by right-click or `menu.open` over a link with **no selection**, instead of the panel's menu;
otherwise the panel's menu, unchanged. Items, in order, each only where offered:

| # | Item (test id `menu-item-<label>`) | Offered when |
|---|---|---|
| 1 | Open Link *(chord where bound)* | always |
| 2 | Open In ▸ New Editor / Active Editor / *<editor name>* | resolved file in the project |
| 3 | Open Preview | resolved file in the project with a provider; disabled when the provider is |
| 4 | Open in OS Explorer | UNC or on-device location (resolved or not) |
| 5 | Open in OS Default Program | resolved non-executable file |
| 6 | Open Program | resolved executable file |
| 7 | Copy Link to Clipboard | always |

Web, loopback, protocol and preview anchor links: rows 1 and 7 only. Identical in terminal, editor and
Markdown preview (SC-025).

### §9.2 The link hint (FR-165, FR-166)

| Event | Result |
|---|---|
| plain click (no drag) on a link of an enabled kind | show hint: FR-168 text, anchored at the last row's bottom-right, `clampToViewport` |
| hover, Ctrl+click, drag, click where that kind is disabled | no hint |
| Ctrl keydown, any link Ctrl+click, another hint, scroll, window blur, `LINK_HINT_MS` | hide |

Never focusable, `pointer-events: none`; the click beneath keeps its meaning.

### §9.3 Pointer and marks (FR-164, FR-172)

Hand pointer on every valid link whenever hovered, with or without the modifier. Terminal marks are
recomputed from the logical lines in view on `onRender`, throttled at `LINK_MARK_THROTTLE_MS` with a
trailing run, and rebuilt on a buffer switch. The hover mark is drawn from the hovered link itself.

### §9.4 Tooltip, hint and readout text (FR-167, FR-168)

| Destination | Text |
|---|---|
| in-project file, `editor.openTarget = lastActive` | Ctrl+Click to open in throng active editor |
| in-project file, `editor.openTarget = new` | Ctrl+Click to open in throng new editor |
| in-project file whose click opens a preview | Ctrl+Click to open in throng preview |
| everything revealed | Ctrl+Click to show in OS Explorer |
| web, loopback | Ctrl+Click to open in system browser |
| protocol | Ctrl+Click to open with the *<scheme>* handler |

Destination by name at hover (research R30). Readout: the full target, bottom-left of that panel's status
bar after persistent content, only while the bar is shown.

### §9.5 Corrections after analysis *(2026-09-19; §9.1, §9.2 and §9.4 kept, amended here)*

- §9.1: for an **unresolved** UNC or on-device link, rows 2, 3, 5 and 6 are drawn **disabled** where the
  grammar says they apply (in project by name; provider or executable by extension) — FR-170a. Row 4 stays
  enabled. Rows 2 – 6 are absent only for web, loopback, protocol and anchor links. Open Link runs the
  surface's own Ctrl+click (FR-169's note).
- §9.2: "scroll" means a scroll the **user** makes; output scrolling a terminal does not hide the hint.
- §9.4 gains two preview rows: in-document heading → "Ctrl+Click to go to the heading"; a link 044
  FR-090e keeps on the current file → "Ctrl+Click to follow". A preview's in-project file → "Ctrl+Click
  to open in throng preview".
- Readout: FR-167a's first reading.

### §9.7 Corrections after analysis, seventh and eighth passes *(2026-09-19)*

- §9.4 gains a row: a folder by grammar (the project root, or a path ending in a separator) → "Ctrl+Click
  to show in OS Explorer" (FR-168b).
- §9.1 / §9.5: before main answers, the menu shows only renderer-known rows — Open Link, Copy Link to
  Clipboard, Open in OS Explorer (UNC / on-device only), and Open In ▸ / Open Preview disabled for an
  in-project-by-name link that is not a folder by grammar; rows 5 and 6 wait for main, whose answer may
  add, enable or remove rows (FR-170c).

---

## §10 Amendment 2026-09-20, round five — the switches, and one hover

§6's "What keeps working" column and §9.4's table **as the tooltip's text** are superseded by §10.1 and
§10.2. §9.1's Link menu, §9.2's hint and §9.3's pointer and marks are unchanged.

### §10.1 The detection switches, restated (FR-180)

| Off | What stops in that panel type | What keeps working |
|---|---|---|
| `editor.links.detectInTerminals` | **every** kind: detected paths, web links, allowlisted protocol links and OSC 8 hyperlinks — mark, hover title, hint, Ctrl+click, Link menu | nothing of throng's. A Ctrl+click reaches a mouse-reporting program exactly as it would over plain text (FR-043) |
| `editor.links.detectInEditors` | the same in editors | nothing. Ctrl+click and Ctrl+Enter keep their ordinary editor meanings |

Four seams read it and each returns nothing rather than filtering afterwards: `linkHitsBetween`,
`linksOnLine`, `terminalViewScan`, and the three OSC 8 closures in `use-terminal.ts` behind one reader
(FR-180a). Live, with no restart, and a terminal at an idle prompt is asked to repaint
(`LinkViewMarks.refresh()`), because nothing else would make it. Labels: **Detect links in editors** /
**Detect links in terminals** (FR-180b).

### §10.2 The hover (FR-169a, FR-169b)

| Event | Surface | Result |
|---|---|---|
| hover a valid link | terminal | native `title` on the `.terminal-panel` host = the full target (`hoveredLinkReadoutText`), cleared on leave and on dispose |
| hover a valid link | editor | native `title` on the mark = a web link's uri, else `linkFirstReadingByName` |
| hover a valid link | Markdown preview | native `title` = the same `displayTarget` its status readout carries |
| hover anything | all three | **no** tooltip, tip or popover drawn by throng, at any delay |

§9.4's destination table is unchanged **as the link hint's text**. `.terminal-link-tip` and its
floating-surfaces entry are gone, and `terminals.linkHoverDelayMs` with them (FR-169b) — a native title
is timed by the OS.

### §10.3 What the title and the readout may claim (FR-187, D8)

Both publish one string, from `linkFirstReadingByName`, and it must be somewhere the click **goes**:

| Text | Title / readout |
|---|---|
| absolute, drive forms included | itself (FR-176) |
| home form (`~/…`) | as written |
| **any other rooted path** (`/tmp`, `/etc/hosts`, `/help`) | **as written** — *supersedes* §9.5's "FR-167a's first reading" for this row, which named the project root |
| relative | joined onto the base directory, else the project root |
| OSC 8 hyperlink | its declared target |
| web / protocol span | its address (a bare email address: `mailto:` + the address, §10.2's D25) |

Row 3 holds **even when that path does resolve inside the project**: the three spellings are one shape
by name, so naming the root for one means naming it for all. FR-024 is unchanged and is about
**resolution**, not about what a hover may claim.

**Known gap (FR-187, reported, not fixed)**: the plain-click **hint** still words row 3 by
`clickTargetByName`'s relative branch and promises an editor, where the click reveals a folder. §9.4's
table is not yet corrected for it, because what it should say is a wording decision the maintainer has
not made.
