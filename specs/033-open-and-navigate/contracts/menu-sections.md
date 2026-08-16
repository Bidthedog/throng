# Contract: one section vocabulary for every menu

**Modules**: `packages/core/src/workspace/menu-sections.ts` (new, pure) · `packages/ui/src/renderer/workspace/context-menu.tsx` · `packages/ui/src/renderer/explorer/context-menu-items.ts` · `packages/ui/src/renderer/editor/content-menu.ts` · `packages/ui/src/renderer/workspace/panel-header-menu.ts` (new, extracted) · `packages/ui/src/renderer/terminal/terminal-content-menu.ts` (new, extracted) · `packages/ui/src/renderer/workspace/tab-group.tsx` · `packages/ui/src/renderer/title-bar/cog-menu.tsx` · `packages/ui/src/renderer/preferences/keybindings-tab.tsx`

**Requirements**: FR-047–FR-053 · SC-010, SC-011 · Principle VI ("One section vocabulary for every menu", v4.6.0)

## 1. The mechanism

```ts
export type MenuSection =
  | 'contextual' | 'content' | 'create' | 'destroy' | 'navigate' | 'viewState' | 'application';
export const MENU_SECTION_ORDER: readonly MenuSection[];
export function groupBySection<T>(items: readonly T[], of: (item: T) => MenuSection): T[][];
```

| # | Guarantee | Requirement |
|---|---|---|
| M1 | `section` is a **required** field on a menu action. An item that declares none is a **compile error**, not a default | FR-049 |
| M2 | A builder's return type has no member that is a divider, so a divider cannot be placed by hand | FR-050 |
| M3 | `ContextMenu` derives dividers per level — **including inside every submenu** — by joining `groupBySection`'s groups | FR-048 |
| M4 | A menu whose items fall in one section carries **no** divider | FR-050, AS-6 |
| M5 | No menu begins or ends with a divider — empty groups are dropped before joining | FR-050 |
| M6 | Dividers are skipped by the keyboard and never take focus. This already ships (`context-menu.tsx:111` excludes `separator` from `enabled`); this feature adds the assertion | FR-051 |
| M7 | Sections and their order live in `@throng/core`, so no menu can hold a different opinion | FR-047 |

## 2. Two readings of the spec, recorded

**FR-052's third column is an inventory of the sections a menu will contain, not an ordering.** Read as
an ordering it contradicts FR-047's *"in this fixed order"* — FR-052 puts **Destroy last** for the panel
header and tab menus, while FR-047 and the constitution both put it third, ahead of Navigate and
View & state. The inventory reading is the one that survives, for three reasons: FR-047 says "fixed",
the constitution says the same, and the Files & Folders menu — which Assumption 7 names as the source
the vocabulary was **derived from** — already ships Delete **before** Open In. AS-3 ("the destructive
item is in a section of its own") and AS-4 ("its destructive items are separated from the rest") are
satisfied by the separation, which says nothing about position.

**The cog menu's row could not be satisfied at all (**resolved 2026-08-15** — FR-052 and US5 AS-5 were both corrected; the cog menu is one undivided Application section)**; see the plan's Complexity Tracking. All five items are
**Application** by FR-047's own table and by the constitution's, and FR-050 permits a divider only at a
section boundary. This contract implements one Application section and **no divider**, and the
requirement is raised for amendment before US5 is marked done.

## 3. Adjudication, menu by menu

`✓` = the item is already in this position; `→` = it moves between sections (permitted — FR-053 protects
order *within* a section); **bold** = added by this feature.

### 3.1 Files & Folders (file / folder / root) — *conforms today; gains US3 and US4*

| Section | Items | |
|---|---|---|
| Content | Rename, Cut, Copy, Paste, Undo, Redo | ✓ |
| Create | New File, New Folder | ✓ |
| Destroy | Delete | ✓ |
| Navigate | Open In *(+ **Terminal** in its submenu)*, Copy Path, **Collapse All Children**, **Expand All Children** | ✓ |
| View & state | Hide in this project | ✓ |

**Zero movement.** The four hand-pushed separators become the four derived boundaries and land in the
same places — which is the evidence that the vocabulary really was derived from this menu. The two
subtree items follow Copy Path, in FR-047's own listed order, and are drawn **only for a folder**
(FR-038: a file can never acquire children, so a disabled row would be permanently dead).

### 3.2 Terminal content menu — *conforms today; one separator disappears*

| Section | Items | |
|---|---|---|
| Contextual | Open Link, Copy Link Address | ✓ |
| Content | Copy, Paste | ✓ |
| View & state | Refresh / redraw terminal, Try again, Copy details, Clear panel type | ✓ |

**The only visible change**: the separator between *Refresh / redraw terminal* and *Try again*
disappears, because both are View & state and FR-050 permits a divider only at a real boundary.

*Why the failure trio is View & state, adjudicated once and applied in both menus that carry it*: each
of the three acts on the panel's **failed state** — retry it, report it, discard it — rather than on the
content. *Copy details* copies a description of that state, not the panel's content. Splitting the trio
across sections was considered and rejected: it would separate three items that are only ever present
together, and it would move them, which View & state does not.

*Why the link items are Contextual and lead the menu*: they are absent when the pointer is not over a
link — the constitution's exact test — and Assumption 8 records that demoting them below Copy/Paste was
rejected as a behaviour regression shipped under a grouping pass.

### 3.3 Editor content menu — *8 items, no dividers today*

| Section | Items | |
|---|---|---|
| Content | Cut, Copy, Paste, Select All, Undo, Redo | ✓ |
| Navigate | **Go To Line** | new |
| View & state | Set Language… *(name)*, Word Wrap | ✓ |

**No existing item moves.** Two dividers appear and one item is inserted between them. Go To Line shows
its current chord via `firstBinding(keybindings, 'navigate.gotoLine')`, supplied through a
`gotoLine: { chord?: string; open: () => void }` bundle on `ContentMenuArgs`, matching the shape
`wordWrap` already uses.

### 3.4 Panel header menu — *11+ items, no dividers today; extracted to `panel-header-menu.ts`*

| Section | Items | |
|---|---|---|
| Content | Rename, Save, Save As…, Revert, Reload from disk | ✓ / → |
| Destroy | Destroy Panel *(or the panel's destroy verb)* | → |
| Navigate | Reveal File in Files & Folders, Open in OS Explorer, Send to Tab, Sync to | ✓ |
| View & state | Reset Name, Zoom, Try again, Copy details, Clear panel type, Refresh / redraw terminal | → |

The biggest restructure in the feature. *Destroy Panel* moves from last to the middle, which is the
fixed order's consequence and the same shape the Files & Folders menu already has. *Reset Name* leaves
Rename's side for View & state, where the constitution names it explicitly. The editor and terminal
conditionals are unchanged — an absent item is simply absent from its group, and an empty group draws no
divider.

### 3.5 Tab context menu — *4 items, no dividers today*

| Section | Items | |
|---|---|---|
| Content | Rename | ✓ |
| Destroy | Destroy Tab, Destroy other tabs | → |
| Navigate | Sync to | → |

*Sync to* moves from second to last. It is the constitution's own example of a Navigate item.

### 3.6 Cog menu — *5 items, no dividers today*

| Section | Items | |
|---|---|---|
| Application | Settings, Key Bindings, Themes, Open Logs Folder, About throng | ✓ |

One section, therefore **no divider** (M4). This is the contradiction recorded in §2 and in the plan.

### 3.7 Key Bindings chord menu — *exempt while it holds one item*

| Section | Items | |
|---|---|---|
| Destroy | `Remove "<token>"` | ✓ |

One section, no divider. The item still declares `section` — the exemption is from grouping, not from
FR-049.

### 3.8 Submenus

All single-section, therefore all divider-free: **Open In** (OS File Explorer, Last Active Editor,
New Editor, Other Tab, **Terminal**) and **Copy Path**'s four forms are Navigate; **Zoom**'s three are
View & state; **Send to Tab** and **Sync to**'s trees are Navigate; **Terminal**'s flavour list is
Navigate.

## 4. What must not change (FR-053, SC-011)

| # | Guarantee |
|---|---|
| N1 | No item's **label** changes |
| N2 | No item's **icon** changes |
| N3 | No item's **action** changes |
| N4 | No item's **order within its section** changes |
| N5 | No item's **test identifier** changes — `menu-item-<label>` is derived from the label, so N1 implies N5 |
| N6 | The two extractions (`panel-header-menu.ts`, `terminal-content-menu.ts`) move code without altering a label, an icon, an action or a condition. They exist so SC-010 can be asserted below E2E |

**One existing assertion must change, and it is not a violation of the above.**
`packages/ui/tests/e2e/context-menu-sections.e2e.ts:49` asserts a folder's Open In submenu holds
**exactly one** item. US3 adds Terminal to it by design (FR-029). SC-011's "the existing menu-driving
end-to-end specs pass unmodified" is true of the grouping pass and false of the feature; the assertion is
updated and the change is recorded in the plan so it is not mistaken for a regression.

## 5. How SC-010 is proved

SC-010 requires "one check that enumerates the menus rather than a per-menu eyeball".

| Layer | Check |
|---|---|
| **unit** — `packages/core/tests/unit/menu-sections.test.ts` | `groupBySection` drops empty groups, preserves intra-group order, and returns one group for a single-section menu |
| **unit** — `packages/ui/tests/unit/menu-sections.test.ts` | Every extracted builder (`buildContextMenuItems`, `editorContentMenu`, `panelHeaderMenu`, `terminalContentMenu`, the tab and cog builders) is invoked over a table of fixtures; for each, assert every item declares a section, that sections appear in `MENU_SECTION_ORDER`, and that the derived divider positions are exactly the boundaries |
| **E2E** — `packages/ui/tests/e2e/menu-sections.e2e.ts` | Open each menu in the running app in turn; read the rendered `<li>` order and assert `.context-menu__separator` appears at every section boundary and nowhere else. This is the check that enumerates the menus |
| **E2E** — `menu-sections.e2e.ts` (AS-8) | Arrow through a menu containing dividers and assert no divider ever takes focus, and that arrowing steps over them (FR-051) |
| **compile** | `tsc` — an item with no section does not build (FR-049), and a section declared in `MenuSection` but left out of `MENU_SECTION_ORDER` does not build either |

*(Corrected 2026-08-16 — two rows.*

*The FR-051 row named `menu-keyboard.e2e.ts`, as did tasks T069 and SC-011's permitted-change table.
The assertion was written as **AS-8 in `menu-sections.e2e.ts`** instead, and stays there: that file
owns dividers, already opens the menus that have them, and already holds the `menuShape` /
`focusableLabels` helpers the assertion needs. It is also stronger than T069 asked for — it first
requires the menu under test to contain a divider at all (guarding the guard, per SC-016) and it
excludes `aria-disabled` rows as well as separators. `menu-keyboard.e2e.ts` received T068's guard
replacement and nothing else.*

*The compile row was true only of items. `MENU_SECTION_ORDER` was annotated `readonly MenuSection[]`,
which accepts a SHORT array, so a section added to the union and not to the order was no compile
error, no runtime error and no test failure — `groupBySection` emits by walking the order, so every
item declaring the unordered section would simply vanish from its menu. That is FR-049's own failure
mode one layer down, and M7's "no menu can hold a different opinion" fails at the source if core can
hold two. The order is now checked rather than annotated, and the union-to-order linkage is asserted
in `packages/core/tests/unit/menu-sections.test.ts` as well, so the guarantee does not rest on a type
alias nothing tests.)*
