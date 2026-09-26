# Contract: Project Categories (IPC, service, migration)

Covers FR-050 – FR-061. The reasoning is in [research.md](../research.md) R9 and R10. The data shapes
are in [data-model.md](../data-model.md) §1, §2 and §7.

## 1. RPC methods (`packages/ipc-contract/src/projects.ts`, additive)

| Method | Params | Result | Errors (`RpcError`, `JSON_RPC_INVALID_PARAMS`) |
|---|---|---|---|
| `projects.list` (existing) | none | `{ projects: ProjectDto[] }`. **`categoryId` is added and always resolved** | none new |
| `projects.categories.list` | none | `{ categories: ProjectCategoryDto[] }` in list order | none |
| `projects.categories.create` | `{ name }` | `{ category }` | empty name after trimming; a name that duplicates another ignoring case |
| `projects.categories.rename` | `{ id, name }` | `{ category }` | the same two, plus an unknown id |
| `projects.categories.delete` | `{ id }` | `{ movedProjectIds: string[] }` | an unknown id; the default category |
| `projects.categories.setMinimised` | `{ id, minimised }` | `{ category }` | an unknown id; the default category |
| `projects.move` | `{ id, categoryId, orderedIds }` | `{ orderedIds }` | an unknown project or category; `orderedIds` not an array of strings (the same check `projects.reorder` makes) |

`ProjectCategoryDto = { id, name, isDefault, minimised, createdAt, updatedAt }`.

- **Refresh.** After any category mutation the renderer calls `projects.notifyChanged`, as the other
  project mutations do (`projects-store.tsx:162-176`). Other windows then refresh.
- **Failures** surface through the store's existing `fail(message, action, subject)` path, with a
  subject naming the category. They never appear as a raw RPC string (030).

## 2. Service rules (core `ProjectCategoryService`, injected into the daemon's `ProjectIpcService`)

- Every call is scoped to the owner, like `ProjectService`.
- `list` and `create` run `ensureDefault(owner)` first.
- `delete` runs in one transaction:
  1. compute the new global order with `mergeIntoDefault`;
  2. set the members' `category_id` to the default category;
  3. rewrite `position`;
  4. delete the row.
- The default category is refused by `delete` and `setMinimised` whatever the caller. The UI also
  draws neither control for it, but the service does not rely on that.
- A project whose `category_id` resolves to nothing is reported under the default category. This is
  the read-time heal rule.

## 3. Migration v9 (`packages/persistence/src/migrations/v9-project-categories.ts`)

Order of operations, each safe to repeat:

1. `CREATE TABLE IF NOT EXISTS project_categories (...)`, plus
   `CREATE INDEX IF NOT EXISTS idx_project_categories_owner`, plus the partial unique index for
   `is_default = 1`.
2. `addColumnsFor(db, 'projects')`. `ADDITIVE_COLUMNS` gains
   `projects.category_id TEXT NOT NULL DEFAULT ''`.
3. For each distinct `owner_user` in `projects` with no default category, insert one
   (`name = SHIPPED_DEFAULT_CATEGORY_NAME`).
4. `UPDATE projects SET category_id = (that owner's default id) WHERE category_id = ''`.
5. `positions` is left untouched, so the existing order is preserved (FR-058, SC-006).

**Tests** (`packages/persistence/tests/integration/`)

| Test | What it asserts |
|---|---|
| `migration-v9.integration.test.ts` (new) | fresh DB to v9; v8 DB with 3 projects to v9 with all 3 in "In Progress" in their old order; running v9 twice gives identical rows; a DB stamped 9 with the column missing is healed by `reconcileSchema` |
| `user-version-pin.integration.test.ts:36` | `LATEST_VERSION` becomes **9** |
| `migration-drift-repair.integration.test.ts` | gains `projects.category_id` |

## 4. Renderer (`projects-panel.tsx`, `projects-store.tsx`)

- The store gains `categories`, plus the actions `createCategory`, `renameCategory`,
  `deleteCategory`, `setCategoryMinimised` and `moveProject`.
- The panel renders `listRows(...)` ([data-model.md](../data-model.md) §7).
- **Header row**
  - It shows the chevron `IconButton` (`chevron` token, hover title *Minimise category* or *Expand
    category*; FR-061), the name, and the count formatted by the shared digit-grouping formatter.
  - The default category's header draws no toggle.
  - Clicking a non-default header toggles minimise (FR-051).
- **Drag** (FR-055)
  - Each category section is a droppable, and so is each minimised header.
  - A drop inside the source category calls `reorderProjects`, as today.
  - A drop inside another category calls `moveProject` at the drop slot.
  - A drop on a minimised header calls `moveProject` at the end of that category.
  - Headers are not draggable.
- **New Category…** opens an inline name field in the list. The Rename Category editor uses the same
  field. A refusal keeps the field open with the reason, as `commitRename` does for projects
  (`projects-panel.tsx:325-333`).

## 5. Iterate round 1 (spec FR-072, FR-075, FR-083, FR-084)

**RPC (additive).** `projects.categories.reorder` `{ orderedIds: string[] }` → `{ categories }`.
`orderedIds` lists the **non-default** categories in their new order; errors are an unknown id, a
missing or duplicated id, the default category's id, and a non-string array (the `projects.reorder`
check). `ProjectCategoryDto` gains `position: number`. `create` appends after every existing
category (FR-084).

**Migration v10** (`packages/persistence/src/migrations/v10-category-position.ts`; v9 is not
edited):

1. `addColumnsFor(db, 'project_categories')`, with `ADDITIVE_COLUMNS` gaining
   `project_categories.position INTEGER NOT NULL DEFAULT 0`.
2. Per owner, seed `position` from the pre-v10 order (default first, then `created_at`, `id`) —
   only for rows not yet seeded, so a re-run changes nothing.
3. `LATEST_VERSION` 9 → 10.

List order becomes: the default first, then `position`, then `id`.

**Tests** (`packages/persistence/tests/integration/`): `migration-v10-category-position.integration.test.ts` (new) —
v9 DB with three categories keeps its visible order; re-run identical; a DB stamped 10 with the
column missing is healed; `user-version-pin.integration.test.ts` reads **10**;
`migration-drift-repair.integration.test.ts` gains the column. Reorder persistence across a reopened
database lives in the category repository's integration test.

**Renderer.**
- *Header style (FR-072)*: every header, the default's included, draws a background from a new
  colour token (`categoryHeaderBackground`, listed with a description in `theme-copy.ts`, shipped by
  the version-13 additive upgrade) and its name in bold uppercase via CSS `text-transform` — the
  stored name and the rename field keep their casing.
- *Header drag and menu (FR-083)*: a non-default header is draggable among the non-default
  headers; no drop lands above the default. The header menu gains **Move Category Up** / **Move
  Category Down** (Navigate section), disabled at the ends, absent on the default. A header drag
  never moves a project, and a project drag never moves a category.
- *Whole-row project drag (FR-075)*: the drag listeners move from the grip to the row; the Edit and
  Remove buttons and the inline inputs stop the drag from starting. A press under the activation
  distance stays a click (switch project), and a double-click on the name still renames.
