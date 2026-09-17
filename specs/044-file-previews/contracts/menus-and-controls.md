# Contract: menus, header controls and status bars

**Feature**: 044 | **Requirements**: FR-001 – FR-003, FR-012, FR-014, FR-015, FR-030, FR-033 – FR-035c, FR-095, FR-104, FR-111; iteration 2026-09-15: FR-116, FR-118; iteration 2026-09-16: FR-122, FR-122a–e (§10, and the rows marked *2026-09-16* in §§1–4, 7, 8)

Section vocabulary and guarantees M1–M7 are [033's](../../033-open-and-navigate/contracts/menu-sections.md).
Every item declares its `section` (a compile error otherwise). `menu-sections.test.ts` gains a `TABLE`
row and an exact `shapeOf` pin for each menu below; `panelActions` (`:247-272`) gains every new
`PanelHeaderMenuActions` key.

Notation: **[D]** disabled when…, **[A]** absent when…, *(chord)* shows the bound chord.

---

## 1. Preview panel — header menu (FR-033)

| Section | Items |
|---|---|
| **Content** | *(none — Rename is absent, FR-030)* |
| **Destroy** | **Close Panel** — verb *Close* (011 FR-030; `panelRemovalVerb`, `panel-placeholder.tsx:196`) |
| **Navigate** | **Reveal File in Files & Folders** · **Open in OS Explorer** · **Open in Editor** / **Go to Editor** [A] binary provider · **Back** *(Alt+Left)* [D] no older entry · **Forward** *(Alt+Right)* [D] no newer entry · **Send to Tab ▸** · **Sync to ▸** |
| **View & state** | **Refresh** · **Zoom ▸** (Zoom In, Zoom Out, Reset Zoom) · while the failure banner is up: **Try again**, **Copy details**, **Clear panel type** (030 FR-042c) |
| *2026-09-16* **View & state** | **Refresh** · **Zoom ▸** · **Synchronise Scrolling** *(preview.toggleSyncScroll)* [A] binary provider — checked while on (§10) · then the failure-banner items |

Never present: Rename, Reset Name, Save, Save As…, Revert, Reload from disk, Find.

**The failure-banner items do on a preview what they do on an editor**, through the preview's own
paths. `PanelHeaderMenuArgs.editorFailure` is renamed `panelFailure` (true while the editor's **or**
the preview's `PanelFailureBanner` is up):

| Item | On a preview |
|---|---|
| **Try again** | `preview.refresh(panelId)` — the banner's retry (FR-028) |
| **Copy details** | the preview notice's message and detail, through the clipboard bridge |
| **Clear panel type** | `preview.destroyed(panelId)` (drops the run, the `byPath` entry and the history), then `clearPanelType` — no dirty prompt, a preview owns nothing (FR-042) |

Without the third row a cleared preview would leave main believing the file still has a preview, so
Open Preview and Open In → Preview would stay disabled for a preview that no longer exists (FR-012).

*Open in OS Explorer* goes through `revealPanelFile` → `files.revealDocument`, whose confinement check
(`files-service.ts:517-528`, `main.ts:1403`) accepts a path that an **editor or a preview** is showing.

## 2. Editor panel — header menu additions (FR-002, FR-111)

Inserted into the existing editor shape (`panel-header-menu.ts:212-305`), Navigate section, after
*Open in OS Explorer* and before *Send to Tab ▸*:

| Item | State |
|---|---|
| **Open Preview** *(preview.open)* | [A] no **text** provider claims the file, no file on disk, or file outside the project (FR-001, FR-004, FR-073); [D] the provider is disabled (FR-062) **or** a preview of the file is open (FR-012) |
| **Back** *(Alt+Left)* | [D] no older entry |
| **Forward** *(Alt+Right)* | [D] no newer entry |

*2026-09-16 (FR-122b)* — **View & state**, after **Zoom ▸** and before the failure-banner items:
**Synchronise Scrolling** *(preview.toggleSyncScroll)* — [A] exactly where Open Preview is absent;
**never** disabled (a disabled provider still shows it enabled, FR-122a); checked while on (§10).

## 3. Editor body menu addition (FR-002)

`editorContentMenu` (`ui/src/renderer/editor/content-menu.ts:75-178`), Navigate section, after
*Go To Line…*: **Open Preview** — same absent/disabled rules as §2.

*2026-09-16 (FR-122b)* — **View & state**, after *Word Wrap*: **Synchronise Scrolling** — same presence
as in §2, checked while on (§10).

## 4. Preview body menu (FR-035, FR-035c, FR-095)

| Section | Items |
|---|---|
| **Contextual** — only when right-clicking a followable link **with no text selected** | **Open Link** *(Ctrl+Enter)* · **Copy Link Address** |
| **Content** — [A] when the provider's `textSelection` is false | **Copy** [D] nothing selected · **Copy as Rich Text** [D] nothing selected · **Copy as Plain Text** [D] nothing selected · **Select All** |
| **Navigate** — [A] binary provider | **Open in Editor** / **Go to Editor** |
| *2026-09-16* **View & state** — [A] binary provider | **Synchronise Scrolling** — checked while on (§10, FR-122b). Present whether or not a link or a selection is under the pointer |

- Over an `inert` link, the Contextual section is absent (FR-095).
- With a selection, the Contextual section is absent even over a link ("the ordinary menu wins").
- The menu key and Shift+F10 on a focused link open this menu for that link (FR-096d).
- *Copy* uses `editor.previews.copyFormat`; the other two ignore it (FR-035b/c).
- *Open Link* on a file link follows it in place, exactly as Ctrl+click (FR-090).
- *Copy Link Address* copies *(iteration 2026-09-15, FR-116)*:

  | Link | Copied |
  |---|---|
  | web / `mailto:` | the URL |
  | project file | the file's absolute path, then `#fragment` as `classifyPreviewLink` records it — **percent-decoded** (`links.ts:116-124`), so `#a%20b` copies as `#a b` — when the link names one |
  | same-document heading | **the preview's own file's absolute path**, then that same decoded `#fragment` — never a bare `#fragment` |
  | outside the project | the target as written |

  Built by `linkAddress(link, docPath)` (`ui/src/renderer/preview/content-menu.ts`), `docPath` being the
  file the panel shows. Where the item sits, its label and its enabled state are unchanged.

## 5. Files & Folders — Open In submenu (FR-003, FR-012)

`buildContextMenuItems` (`ui/src/renderer/explorer/context-menu-items.ts:62`), `openInItems`
(`:148-151`), for a **file**:

```text
Open In ▸  OS File Explorer            ← stays first (explorer.e2e.ts)
           Last Active Editor (…)      ← existing
           New Editor                  ← existing
           Other Tab ▸                 ← existing
           Preview                     ← NEW  [A] folder, no provider claims the file, outside project
                                                [D] provider disabled (FR-062) or preview open (FR-012)
           Terminal                    ← existing
```

*Preview* is passed in as its own argument by `file-tree.tsx`; it is **not** added to
`describeOpenInTargets`/`openInMenuActions`, which Find in Files rows share
(`find-in-files/result-open.ts:192-200`).

## 6. Header controls — every editor and preview panel (FR-104)

Header order (`panel-placeholder.tsx:506-828`), left to right:

```text
[◀ Back][▶ Forward] [type icon] [title] [editor file pill] [unsaved dot] [ADMIN] [owner] … [+][✕]
 └─ NEW, before the type icon                         └─ now also shown on a PARENTED, dirty preview (FR-040)
```

- Both buttons are drawn on every editor and preview panel, **disabled** at the ends — never hidden.
- `IconButton` (`ui/src/renderer/common/icon-button.tsx:82`), tokens `navigateBack` / `navigateForward`,
  `aria-label` *Back* / *Forward*, `title` *Back (Alt+ArrowLeft)* / *Forward (Alt+ArrowRight)* — the live binding's token as stored, the
  same form every other binding is shown in.
- The buttons stop `pointerdown` propagation so they do not start the header's dnd-kit drag
  (`tab-group.tsx:714`, 4 px activation).
- The unsaved dot gate (`panel-placeholder.tsx:776`) becomes: editor with `editorUi.dirty`, **or**
  preview with `update.dirty` (which main only sets while parented). A standalone preview never shows
  it (FR-043).
- Title for a preview: `panelDisplayTitle` preview branch (data-model §7); not renamable, no
  double-click handler, no rename starter registered (FR-030).
- No other panel type gets the buttons (FR-100).

## 7. Editor status bar — preview button (FR-001, FR-014)

Inside the controls group (`ui/src/renderer/editor/status-strip.tsx:479-511`), after the wrap toggle.
The group is measured whole (`:351`, `:323`), so the button is never hidden by width (040
FR-023/FR-024) and needs no change to `status-strip-fit.ts`.

| State | Rendering | Click |
|---|---|---|
| [A] no text provider claims the file / no file / outside project | not rendered | — |
| [D] provider disabled | token `preview`, `disabled`, title *Markdown previews are turned off — Preferences → Editor → Previews* (the provider's `displayName`) | — |
| no preview open | `IconButton` token `preview`, `aria-pressed="false"`, title *Open Preview* | `preview.open` |
| preview open (any window) | `aria-pressed="true"`, title *Go to Preview* | focus the preview (FR-014); never closes it |

The pressed state reads `preview-open-store` (`throng:preview:openChanged`), so it follows a preview
opened or closed in another window.

*2026-09-16 (FR-122c)* — the **scroll-sync toggle** sits **immediately before** the preview button in
the same measured group (`status-strip.tsx:565`), so it is never hidden by width (040 FR-024) and only
with the whole bar (040 FR-033). Rendered exactly when the preview button is (any state but absent),
and **enabled** even when the preview button is disabled for a switched-off provider (FR-122a). See §10.

## 8. Preview status bar (FR-015a, FR-015e)

Same element and classes as the editor's status strip, following `editor.showStatusBar`. **No
readouts.** Controls group holds one button:

| Preview is | Button | Click |
|---|---|---|
| standalone | token `editorPanel`, `aria-pressed="false"`, *Open in Editor* | open an editor to the preview's **left** (FR-015c) |
| parented | token `editorPanel`, `aria-pressed="true"`, *Go to Editor* | focus the parent, its tab and window (FR-015d) |
| binary provider | — the status bar is **not rendered** (FR-015e) | — |

**One readout** *(iteration 2026-09-15, FR-118 — supersedes "No readouts" above for this readout only)*:

| Readouts group holds | When |
|---|---|
| the hovered or focused followable link's target — the link title's text without " — Ctrl+click to follow" (bidi controls stripped, from `data-throng-target`) | pointer over a followable link (an image inside one counts as the link), or keyboard focus on one (FR-096b) |
| nothing | pointer and focus have left every link; the panel's file changed |

When both apply, the **hovered** link wins; when the pointer leaves it while another link still has
keyboard focus, the readout falls back to the focused link's target rather than clearing. The body reports
hover and focus separately; the chrome resolves them in that order.

- Text only — no control, so Principle VI's menu-item rule adds nothing, and no icon token.
- The editor strip's readout class; a target wider than the space left beside the controls group is
  clipped with an ellipsis. The element's text is the whole target, and the controls group is measured
  whole as before, so *Open in Editor* / *Go to Editor* is never hidden by it.
- Rendered only inside the bar, which already follows `editor.showStatusBar`; with the bar hidden the
  link's tooltip (FR-094) is the surface.
- An image inside a followable link: the readout names the link, and the image carries no tooltip of its
  own (FR-120, security-policy Layer 2).

**Two controls** *(2026-09-16, FR-122c — partly supersedes "Controls group holds one button")*: the
**scroll-sync toggle** (§10), immediately before the Open in Editor / Go to Editor button, then that
button. Both on every text-provider preview, standalone or parented; the group is measured whole, so the
readout never pushes either out.

## 9. Notices in a preview (FR-026, FR-027, FR-090e, FR-106c)

One slot per condition class, never both for one condition:

| Condition | Surface | Action(s) |
|---|---|---|
| Unreadable, deleted, too large, not text (FR-026) | shared `PanelFailureBanner` (no notification pointer) | Try again (= Refresh), Copy details, Clear panel type (030 FR-042) |
| File type has no preview (FR-027) | shared `PanelFailureBanner` | **Close** |
| Link target missing / outside / heading not found (FR-090e/f); history target refused (FR-106c) | preview link notice (inline, dismissible) | Dismiss |

A repeat of the same condition flashes the existing notice (`common/notification.tsx:581-646` is the
flash precedent) rather than raising a second one. Messages say what is wrong, never what the user
may not do.

## 10. Synchronise Scrolling — every surface *(iteration 2026-09-16, FR-122, FR-122a–e)*

One command, `preview.toggleSyncScroll`, one body (`renderer/preview/sync-scroll-toggle.ts`), one
setting (`editor.previews.syncScroll`). No surface holds state of its own; each reads the setting from
the window's config store.

| Surface | Where | Rendering |
|---|---|---|
| Editor body menu | View & state, after *Word Wrap* (§3) | label `Synchronise Scrolling ✓` while on, `Synchronise Scrolling` while off (the Word Wrap idiom); test id `menu-item-Synchronise Scrolling`; icon `syncScroll`; shortcut = live chord |
| Editor header menu | View & state, after *Zoom ▸*, before the banner items (§2) | as above |
| Preview body menu | View & state, last section (§4) | as above |
| Preview header menu | View & state, after *Zoom ▸*, before the banner items (§1) | as above |
| Editor status bar | immediately before the preview button (§7) | `IconButton` token `syncScroll`, `aria-pressed` = setting, `title` *Synchronise Scrolling* + ` (<chord>)` when bound, test id `editor-sync-scroll-<panelId>` |
| Preview status bar | immediately before Open in Editor / Go to Editor (§8) | as above, test id `preview-sync-scroll-<panelId>` |
| Key binding | editor or preview focused | ships unbound; acts only where a surface above is present |

**Presence** (FR-122a): an editor whose preview affordance is not `absent`; every `text`-provider
preview. **Absent**: a binary preview; an editor with no provider, no file, or a file outside the
project. **Never disabled** — not while a provider is off, and not while a preview is open.

**Choosing it** writes `{ path: ['editor','previews','syncScroll'], value: !current }` and nothing else
(032 FR-001). **On failure** nothing on any surface changes (no optimistic state) and the window that
made the write shows the one `prefs-notice` — including a sub-workspace window, which mounts the
failure subscriber from this iteration on (plan decision 2). Every window, and an open Preferences
window, follows a successful write through the config store (032 FR-004).

**Principle VI**: the four menu items are the canonical route; the two buttons are accelerators, so a
hidden status bar strands nothing. `menu-sections.test.ts` pins the four shapes and `panelActions` gains
`toggleSyncScroll`; `menu-icon-tokens.test.ts` gains `syncScroll`.
