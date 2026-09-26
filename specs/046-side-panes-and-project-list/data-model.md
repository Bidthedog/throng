# Data Model: Side Panes and Project List

**Feature**: 046 | **Date**: 2026-09-23 | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

The model has three kinds of state:

- **Persisted**: stored in SQLite (§1, §2) or in the configuration files (§3, §4).
- **Session-only**: held by the renderer (§5, §6).
- **Derived**: computed by pure core functions (§7, §8).

The unloaded style, pane visibility and the per-project layout are existing state. This feature
reuses them unchanged and does not model them again here.

---

## 1. ProjectCategory (new, persisted)

Table `project_categories`, migration v9 ([research.md](./research.md) R9).

| Field | Column | Type | Rules |
|---|---|---|---|
| `id` | `id` | string (uuid) | Primary key |
| `ownerUser` | `owner_user` | string | Per-user local storage. Every query is scoped by it |
| `name` | `name` | string | Trimmed and non-empty. Unique per owner under `trim().toLowerCase()`. A duplicate is refused inline (spec Edge Cases). *Amended at implementation*: `toLowerCase`, not the `toLocaleLowerCase` first written here and in research R9, to match every other uniqueness rule in core and keep the answer independent of the machine's locale (Turkish `I`) |
| `isDefault` | `is_default` | boolean | Exactly one per owner, enforced by a partial unique index. Seeded with the name `SHIPPED_DEFAULT_CATEGORY_NAME` = "In Progress" from core (FR-050, Principle X) |
| `minimised` | `minimised` | boolean | Always `false` when `isDefault`. `setMinimised` refuses the default (FR-050, FR-051) |
| `createdAt` / `updatedAt` | `created_at` / `updated_at` | ISO string | `createdAt` orders the non-default categories (FR-056) |

**List order**: the default category first, then the rest by `createdAt`, then `id` (FR-056).

*Iterate round 1 (spec FR-083, FR-084):* migration **v10** adds `position` (`project_categories.position`,
integer, additive, seeded from the order above so an upgraded list looks the same). The list order
becomes the default first, then `position`, then `id`. `create` appends (`max(position) + 1`); a
`reorder {orderedIds}` over the non-default categories rewrites `position` in one transaction and
refuses the default's id. The default category's `position` is never consulted. Contract:
[contracts/project-categories.md](./contracts/project-categories.md) §5.

**Invariants**

- The default category exists before any read returns. `ensureDefault(owner)` runs inside `list` and
  `create`.
- The default category cannot be deleted or minimised by any route. The service refuses both, and the
  UI draws neither control (FR-050, US5 scenario 4).
- It can be renamed (FR-050). The new name is subject to the same uniqueness rule.

**Transitions**

| Action | Allowed on | Effect |
|---|---|---|
| create `{name}` | any owner | New non-default category, `minimised = false`, listed last |
| rename `{id, name}` | any category | Name replaced after validation |
| setMinimised `{id, minimised}` | non-default only | Flag set (FR-051) |
| delete `{id}` | non-default only | In one transaction: its projects move to the default category, appended after the default's existing members and keeping their relative order; then the row is deleted (FR-054) |

## 2. Project (existing, extended)

Table `projects`. The change is additive.

| Field | Column | Type | Rules |
|---|---|---|---|
| `categoryId` | `category_id` | string | New. `NOT NULL DEFAULT ''`, registered in `ADDITIVE_COLUMNS`. **Read rule**: `''`, or an id naming no category of the owner, resolves to the default category, so `ProjectDto.categoryId` is never `''` |
| `position` | `position` (v3) | integer | **Unchanged meaning**: a global total order. A category's order is `position` filtered to that category (R9) |

Every other field (`name`, `colour`, `rootFolder`, `hiddenPaths`, `isActive`) is untouched (FR-060).

**Transitions**

| Action | Effect |
|---|---|
| create | `categoryId` = the owner's default category; appended at the end of the global order (FR-059) |
| reorder `{orderedIds}` | Unchanged (`projects.reorder`). Used for a drag within one category |
| move `{id, categoryId, orderedIds}` | In one transaction: set `categoryId`, then rewrite `position` from `orderedIds` (FR-055, Move to Category) |
| delete | Unchanged (it kills the project's terminals first) |

**Migration v9 (FR-058)**: idempotent, covered by the schema-drift guard and by a user-version pin
moved from 8 to 9. The sequence and the re-run proof are in
[contracts/project-categories.md](./contracts/project-categories.md) §3.

## 3. Settings (new, persisted in `settings.json`)

| Key | Values | Default | Preferences group | Descriptor |
|---|---|---|---|---|
| `confirmations.unloadProject` | `none` \| `single` \| `double` | `double` | Confirmations. It sits beside `destroyProject` and has the same `confirmDescriptor()` control (FR-034b) | Label *"Unload a project with running terminals"* |
| `projects.unloadTerminalAction` | `keepRunning` \| `endTerminals` | `keepRunning` | Confirmations, placed directly after the entry above (FR-034a) | Label *"Unload project: default terminal action"*; `optionLabels` *Keep terminals running* / *End terminals* |

- Both keys use the tolerant parse, so an unknown value falls back to its default.
- A settings leaf needs no `SHIPPED_DEFAULTS_VERSION` bump (`shipped-defaults.ts` comment at `:181`).
- `settings-metadata.test.ts` goes red until both descriptors exist.
- `DestroyConfirmSettings` (`packages/core/src/workspace/destroy.ts:20-25`) is **not** widened.
  Unload has its own planner (§8), so no destroy target gains a meaning it does not have.
- *Iterate round 1 checkpoint (2026-09-24, spec FR-111):* `confirmations.unloadProject` is
  **withdrawn** — no descriptor, no control, no parse, no planner input. A value already saved in a
  development `settings.json` stays in the file as an unmodelled key, which the write path
  preserves. `projects.unloadTerminalAction` is unchanged.
  *Corrected in implementation (2026-09-25, spec FR-111's supersede note):* the write path does
  not preserve it. `writeConfigPatch` normalises through `parseSettingsGuarded`, which drops
  unmodelled keys, so the next settings write drops it, as 019 FR-023 does for a retired key.

## 4. Key bindings (new commands, persisted in `keybindings.json` only when the user saves)

| ActionId | Scope | Default (Windows) | Group | Label |
|---|---|---|---|---|
| `project.next` | `EVERYWHERE` | `Ctrl+Alt+PageDown` | View | Next Project |
| `project.previous` | `EVERYWHERE` | `Ctrl+Alt+PageUp` | View | Previous Project |
| `focus.explorer` | `EVERYWHERE` | **`Ctrl+Alt+F`** (FR-021 replacement for Ctrl+Alt+E, R1) | View | Focus File Explorer |
| `focus.projects` | `EVERYWHERE` | `Ctrl+Alt+P` | View | Focus Projects |
| `zoom.reset` (changed) | `EVERYWHERE` | `Ctrl+0`, **`Ctrl+Shift+0`**, `Ctrl+MiddleClick` | Zoom | unchanged |

- The four new ids join `WINDOW_HANDLED_ACTIONS` (`app.tsx:216-244`).
- They are **window commands** for `isPanelScoped` (`scope.ts:172-206`):
  - `focus.*` is already covered by its prefix.
  - `project.next` and `project.previous` are added as **exact matches**, not a `project.` prefix,
    for the reason `navigate.quickOpen` records there.
- "View" is the group that already holds `view.toggleProjects` and `view.toggleExplorer`
  (`keybindings-metadata.ts:91-109`), which is FR-022's "group that holds the other side-pane
  commands".
- A saved keybindings file is never rewritten. The new ids take their defaults beside it (026
  FR-030, FR-023).

**Defaults superseded at the iterate round 1 checkpoint (2026-09-24, spec FR-102 – FR-108).** The
table above records what shipped at version 12. The defaults now are:

| ActionId | Default (Windows) | Group |
|---|---|---|
| `project.next` / `project.previous` | `Ctrl+Shift+Alt+PageDown` / `Ctrl+Shift+Alt+PageUp` | View |
| `focus.explorer` / `focus.projects` | `Ctrl+Shift+Alt+F` / `Ctrl+Shift+Alt+P` | Focus & Zoom (FR-087) |
| `zoom.in` / `zoom.out` / `zoom.reset` | `Ctrl+Shift+Alt++` / `Ctrl+Shift+Alt+-` / `Ctrl+Shift+Alt+0` | Zoom |
| `panel.zoomIn` / `zoomOut` / `zoomReset` | `Ctrl+Alt++`, `Ctrl+WheelUp` / `Ctrl+Alt+-`, `Ctrl+WheelDown` / `Ctrl+Alt+0`, `Ctrl+MiddleClick` | unchanged |

*Superseded (Session 2026-09-25, FR-113 – FR-115): `zoom.reset` is **Ctrl+Shift+Alt+Numpad0**, not
`Ctrl+Shift+Alt+0`, and has no "Zoom" menu group — the cog menu's Zoom row is withdrawn (FR-113),
so this command has no menu route at all. `panel.zoomReset` is **Ctrl+Alt+Numpad0**, `Ctrl+MiddleClick`,
not `Ctrl+Alt+0`. Both bind to the physical `Numpad0` key, not the main-row `0` (FR-114).*
| `focus.left` / `right` / `up` / `down` | `Ctrl+Shift+Alt+ArrowLeft` / `Right` / `Up` / `Down` | unchanged |
| `focus.notice`, `view.toggleProjects`, `view.toggleExplorer`, `tabs.openPicker` | `Ctrl+Shift+Alt+M`, `+B`, `+N`, `+T` | unchanged |
| `editor.toggleWordWrap` | `Ctrl+E W` (two strokes) | unchanged |

*Superseded (iterate round 3, 2026-09-25, FR-116 – FR-117, S27): the `focus.explorer` /
`focus.projects` row (`Ctrl+Shift+Alt+F` / `Ctrl+Shift+Alt+P`) and the `focus.notice` /
`view.toggleProjects` / `view.toggleExplorer` row (`Ctrl+Shift+Alt+M`, `+B`, `+N`) above are
version 13's values. The Windows defaults now are the table below, and one command is new.
`Ctrl+Shift+Alt+F` and `Ctrl+Shift+Alt+P` are unbound; no shipped default takes either.
`tabs.openPicker` keeps `Ctrl+Shift+Alt+T`, and every other row above is unchanged.*

| ActionId | Scope | Default (Windows) | Group | Label |
|---|---|---|---|---|
| `focus.projects` | `EVERYWHERE` | `Ctrl+Shift+Alt+B` | Focus & Zoom | Focus Projects |
| `focus.workspace` (new, FR-116) | `EVERYWHERE` | `Ctrl+Shift+Alt+N` | Focus & Zoom | Focus Workspace |
| `focus.explorer` | `EVERYWHERE` | `Ctrl+Shift+Alt+M` | Focus & Zoom | Focus File Explorer |
| `view.toggleProjects` | `EVERYWHERE` | `Ctrl+Shift+Alt+J` | View | unchanged |
| `view.toggleExplorer` | `EVERYWHERE` | `Ctrl+Shift+Alt+K` | View | unchanged |
| `focus.notice` | `EVERYWHERE` | `Ctrl+Shift+Alt+V` | Focus & Zoom | unchanged |

- `focus.workspace` is keyboard-only (no menu item, constitution VI's "a chord MAY stand without a
  menu item"). It joins `WINDOW_HANDLED_ACTIONS` in `app.tsx`, its `focus.` prefix already makes it
  a window command for `isPanelScoped`, and its description in `keybindings-metadata.ts` names no
  chord (FR-119). It is tier 1 in FR-101's tier table (`keybindings-tiers.test.ts`).

- A `Ctrl+Shift+Alt` token is matched on the physical key (spec FR-104). The keypad `+` and `-`
  are the same binding as the main-row key, and no `Numpad…` token is ever shipped or emitted for
  them (FR-105).

  *Superseded in part (Session 2026-09-25, FR-114, further amended by convergence T168): the keypad
  `0` (`Numpad0`) is a separate, physical-only match, distinct from the main-row `0`, for **every**
  command — not the same binding, and not only for `zoom.reset` / `panel.zoomReset`. A `Numpad0`
  token exists and is emitted; `zoom.reset` and `panel.zoomReset` are simply the only commands whose
  shipped default uses it. The `+` / `-` same-binding rule above is unaffected.*
- `SHIPPED_DEFAULTS_VERSION` 13 moves a saved array only when it still equals an old shipped value
  (the version-11 or version-12 value listed in FR-108), and never onto a chord or gesture the
  user's own bindings hold. It is idempotent.

  *Extended (iterate round 3, 2026-09-25, FR-118): `SHIPPED_DEFAULTS_VERSION` is **14**, and
  version 13 is not edited (the maintainer's config already holds a 13 marker). Version 14 is a
  keybindings payload only. A frozen `V13_KEYBINDINGS` record in `shipped-defaults.ts` holds what
  version 13 wrote for FR-117's five rows (`focus.notice` `Ctrl+Shift+Alt+M`, `view.toggleProjects`
  `+B`, `view.toggleExplorer` `+N`, `focus.explorer` `+F`, `focus.projects` `+P`). It is a copy,
  never a reference to the live defaults, and it joins the version-11 and version-12 values as a
  third guard source in `planFR108Rows`. A row moves only when its saved array is still
  set-identical to one of those sources, and it always moves to the live shipped value, so an
  install at 11 or 12 lands on FR-117's chord in one pass. The fixed-point collision guard is
  unchanged: `focus.projects` taking B while `view.toggleProjects` gives B up is not refused, and it
  is refused when a customised `view.toggleProjects` still holds B. One new-action rule rides the
  same bump: where `focus.workspace` is absent from the saved file and `Ctrl+Shift+Alt+N` collides
  with a binding that is not moving, version 14 writes `focus.workspace: []`, which the Key Bindings
  editor shows as unbound. Otherwise the action stays absent and `parseKeybindings`' per-read fill
  supplies N. A second run plans nothing, including over a file where `[]` was written.*
  *Extended (iterate round 5, 2026-09-26, FR-124, S29): shipped-defaults version **15**, a keybindings
  payload only, moves an untouched `editor.toggleWordWrap: ['Ctrl+E W']` (the version-13/14 default)
  to `Ctrl+E,W`, with a frozen `V14_KEYBINDINGS` as a further guard source; version 14 is not
  edited. The two-stroke token's canonical form is `Mods+K1,K2`; a legacy space-form token
  normalises to it on read.*
- `tabs.openPicker` is a window command for `isPanelScoped` (added in `3b04ec33`, FR-110), beside
  `project.next` / `project.previous`.

## 5. DispatchScope and ActivePane (existing unions, widened)

| Type | Before | After |
|---|---|---|
| `DispatchScope` (`core/src/config/keybindings.ts:169`) | `editor \| terminal \| explorer \| findInFiles \| preview` | + **`projects`**. It is a member of `EVERYWHERE` only. `SCOPE_NAMES.projects = 'Projects'`, and it is appended to `SCOPE_ORDER` |
| `ActivePane` (`ui/src/renderer/workspace/active-pane.ts:11`) | `files \| workspace` | + **`projects`** |

`currentScope`: `workspace` gives the scope of the active panel's kind, `projects` gives `projects`,
and `files` gives `explorer`.

## 6. Loaded state (existing, session-only)

`loadedIds: ReadonlySet<string>` in `projects-store.tsx:88`. It gains **one** new public
transition:

| Action | Precondition | Effect |
|---|---|---|
| `unloadProject(id)` | `loadedIds.has(id)` | `loadedIds.delete(id)`. If `openedId === id`, set `openedId = null` (FR-036) |

Loaded state is not persisted, and every project starts unloaded after a restart, as today.

**The projects row focus pointer** (`focusedRowKey`) is component state inside the Projects panel.
It is `project:<id>` or `category:<id>`. It is not persisted, and it is never the same thing as the
active project (FR-018).

## 7. Project list rows (derived, pure; `packages/core/src/projects/project-list.ts`)

```text
ListRow =
  | { kind: 'category', category: ProjectCategory, count: number, collapsible: boolean }
  | { kind: 'project',  project: ProjectDto, categoryId: string, pinnedActive: boolean }
```

- `listRows(projects, categories, activeId): ListRow[]` works in category order. It emits the header,
  then, if the category is expanded, its projects in `position` order.
  - If the category is minimised, it emits only the active project, when it belongs there, with
    `pinnedActive = true` (FR-052).
  - `count` is the number of projects in the category, including any hidden ones (FR-051).
  - `collapsible` is `!isDefault`.
- `reachableProjectIds(rows): string[]` is the project rows in order. That is every listed project,
  plus the pinned active one (FR-012, SC-007).
- `stepProject(reachable, activeId, dir): string | null` has three cases:
  - At an end, or with fewer than two reachable projects: `null` (FR-011). *Superseded (recorded at
    implementation, analysis I1b): this applies only with a project active. With `activeId` null the
    next case wins even for one reachable project (spec FR-011's Recorded note, T004); only an empty
    list gives `null`.*
  - With `activeId` null: the first project for `+1`, the last for `-1` (R5).
  - Otherwise: the neighbour.
- `validateCategoryName(name, existing): { ok: true, name } | { ok: false, reason }` enforces the
  trim, non-empty and case-insensitive uniqueness rules (FR-053).
- `mergeIntoDefault(orderedIds, categoryOf, deletedId, defaultId): string[]` produces the global
  order after a delete (FR-054). The daemon and a unit test share it.

## 8. Unload plan (derived, pure; `packages/core/src/workspace/unload.ts`)

```text
UnloadInput = {
  level: ConfirmLevel,              // confirmations.unloadProject
  defaultAction: 'keepRunning' | 'endTerminals',   // projects.unloadTerminalAction
  busyCount: number,                // running processes outside sub-workspaces
  variant?: 'keepRunning' | 'endTerminals'         // chosen from a variant menu row
}
UnloadStep =
  | { kind: 'choose', focus: 'keepRunning' | 'endTerminals' }   // 3-button dialog
  | { kind: 'confirmEnd' }                                        // wry second confirmation
  | { kind: 'apply', action: 'keepRunning' | 'endTerminals' }
```

| `busyCount` | `level` | Steps |
|---|---|---|
| 0 | any | `apply(keepRunning)`. Idle shells close under either action, so the two are the same (FR-034c) |
| > 0 | `none` | `apply(variant ?? defaultAction)` |
| > 0 | `single` | `choose(focus = variant ?? defaultAction)`, then apply what the user picked |
| > 0 | `double` | as `single`. If the pick is End terminals, `confirmEnd` comes before `apply(endTerminals)`. Keep running asks nothing more |

**Changed at implementation (T053/T066):** the `choose` step also carries `next: Record<action, UnloadStep[]>`, the steps after each button, so the orchestrator never re-derives the `double` rule.

**Cancel** at any step ends the flow. Nothing is changed (FR-034d).

**Superseded at the iterate round 1 checkpoint (2026-09-24, spec FR-111).** No Unload row prompts,
so the plan has no `choose` and no `confirmEnd` step, and it takes no `level`:

```text
UnloadInput = {
  defaultAction: 'keepRunning' | 'endTerminals',   // projects.unloadTerminalAction
  variant?: 'keepRunning' | 'endTerminals'         // the opposite-action row (FR-081)
}
plan(input) = [{ kind: 'apply', action: variant ?? defaultAction }]
```

`busyCount` no longer changes the steps. It stays useful only for naming what is being ended in a
log line, if the implementation wants one.

The **unsaved-editor prompt** (FR-035) runs **before** this plan and is not part of it. It is the
same `promptDirtyClose` step that Remove uses.

**`projectPanelIdsInSubWorkspaces(projectId, subWorkspaces): string[]`** sits beside
`findProjectPanelsInSubWorkspaces` in `destroy.ts`. It returns the panel ids that must be spared
(FR-037), and its result is passed as `exceptPanelIds` ([contracts/unload.md](./contracts/unload.md)).
