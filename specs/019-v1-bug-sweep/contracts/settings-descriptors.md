# Contract: Settings descriptors & the record-list control

**Feature**: 019 | Governs FR-016…FR-024 (C1, C2, C9, **C11**, **C12**, C13, C14, **C17**) — §3's
`terminals.disabledBuiltins` → multiselect is FR-016/FR-017, not only the FR-018+ record control.
C11 (§2: order preserved, never sorted), C12 (§5: an executable is non-empty, not existence-checked) and
**C17** (§2: `rowKey`, index keying, the row-error cell; §7's duplicate-id journey — this contract's
newest obligations) drive normative rules here and were missing from this list. C10 belongs to
[terminal-flavours-ipc.md](./terminal-flavours-ipc.md) and is kept only as a pointer. |
**Tested by**: `packages/core/tests/unit/settings-open-on-click-single-owner.test.ts`,
`packages/ui/tests/e2e/preferences-terminal-flavours.e2e.ts`

---

## 1. Registry additions (`packages/core/src/config/metadata.ts`)

```ts
export type ControlKind = … | 'records';   // NEW: an ARRAY of records, keyed by a declared id field

export interface FieldDescriptor {
  …
  /** `records` only — the property that identifies a row. Immutable once created (C13). */
  idKey?: string;
  /** `records` only — what one row IS ('flavour'). Labels the affordances and names the test ids. */
  itemNoun?: string;
}
```

**MUST**: the mode is **declared**, never inferred from the value (**FR-018**). Today `control:'array'`
lets the control type flip with the data — `[].every(...)` is vacuously true, so an *empty*
`terminals.flavours` renders as a string-array control whose Add appends `''` (an empty **string** into
an array of **objects**, which the tolerant parser then drops), and one entry later it is a JSON
textarea.

**MUST NOT**: add a second table component. **FR-020**: 016's control is generalised or replaced, never
duplicated. `records` is a mode of `map-control.tsx`.

## 2. `map-control.tsx` — one component, two modes

| Concern | `map` mode (today, unchanged) | `records` mode (new) |
|---|---|---|
| value | `Record<string, unknown>` | `Array<Record<string, unknown>>` |
| row key | the map key | **the row index** — `record[idKey]` is NOT unique for file-authored input (C17) |
| order | sorted by display text (`:67-69`) | **preserved — never sorted** (C11) |
| key column | rendered as text (`:130`) | the id, rendered as text — **not editable** (C13) |
| add | `map-add-${key}` | `${itemNoun}-add` |
| commit | `{ ...map, [key]: … }` | `[...records]` with the row replaced — **never** an object |

**MUST**
- guard the value with an array-aware reader in `records` mode. `asMap` (`:29-30`) rejects arrays
  outright, which is why feeding it `terminals.flavours` today renders an empty table and **the first
  commit overwrites the array with an object**
- preserve order (**C11**): order is user-visible — it is the panel dropdown's order, and
  `mergeFlavours` is first-wins. The `map` mode keeps its sort, where order is meaningless
- keep the add/remove affordances on `IconButton` with hover titles, exactly as `:143-148` / `:201-206`
  (constitution v3.12.0, non-negotiable)
- refuse an invalid commit **in the editor, with a reason** (FR-019) via the existing error region
  (`:208-212`), the idiom `validateKey` (`:38-55`) established

- handle a **duplicate id that arrived from the file** (C17): the JSON tab ships and `parseTerminals`
  does **not** dedupe `terminals.flavours`, so this input is reachable. Render **every** row in file
  order; key rows by **index** (React) and address them by **`rowKey`** (test ids, see §2's table);
  flag the offending row in its **own** `${itemNoun}-row-error-${rowKey}` cell with
  `validateFlavourRecord`'s "already" message. `dedupeById` (`flavour.ts:55`) cannot help here — it is
  **not exported**, it operates on the *merged runtime* list, and it only shapes the **launch list**,
  which stays first-wins and unchanged

**MUST NOT**: sort in `records` mode; make an id editable; write an empty record the tolerant parser
would drop; **silently drop or auto-dedupe a row the user's file contains** (C17 — hiding a row the user
typed is the same silent-drop defect this feature exists to fix).

### The text cell (C14) — `MapCell` (`:237-278`)

**MUST** render `control: 'text'` as `<input type="text">`. Today anything that is not
`control:'number'` falls through to a `<select>` over `allowedValues ?? options ?? []` (`:264-277`) —
so `terminals.defaultParams`, which declares `columns:[{label:'Arguments',control:'text'}]`
(`settings-metadata.ts:185-186`), renders an **empty `<select>`**. It has zero test coverage today, so
this fix ships **with a regression test** (C14), not with an issue.

### Test ids (the RED tests are the contract)

| Element | `records` mode | `map` mode (unchanged — 016's E2E depends on it) |
|---|---|---|
| control root | `control-${descriptor.key}` | `control-${descriptor.key}` |
| row | `${itemNoun}-row-${rowKey}` | `map-row-${descriptor.key}-${key}` |
| cell | `${itemNoun}-cell-${rowKey}-${column.key}` | `map-cell-${descriptor.key}-${key}-${column.key}` |
| **row error** (NEW) | `${itemNoun}-row-error-${rowKey}` | — (no per-row errors in `map` mode) |
| new-id input | `${itemNoun}-new-id` | `map-new-key-${descriptor.key}` |
| add | `${itemNoun}-add` | `map-add-${descriptor.key}` |
| error (control-level) | `${itemNoun}-error` | `map-error-${descriptor.key}` |

**`rowKey`** (C17) = the row's `id` for the **first** row claiming that id; `${id}-${index}` for each
subsequent row claiming it. **For unique ids `rowKey === id`**, so every id the RED E2E drives
(`flavour-row-my-wsl`, `flavour-cell-my-wsl-label`, `:175-217`) resolves exactly as written — no RED
assertion moves. The suffix exists only for a **file-authored duplicate** (reachable: the JSON tab
ships and `parseTerminals` does not dedupe), where an id-derived id would otherwise put **two elements
behind one test id** — a Playwright strict-mode violation, which is undefined behaviour wearing a
locator. First-wins for the un-suffixed name follows `mergeFlavours`'s existing precedent.

**The row-error cell is new and load-bearing**: the control-level `${itemNoun}-error` region
(`map-control.tsx:208-212`) is driven by **transient add/commit state** and cannot speak for a row that
was never committed through the editor, which is exactly the C17 case. It keeps its current job and its
test id unchanged (the RED E2E asserts on it at `:198`/`:205`/`:215`).

Two schemes, deliberately: renaming 016's ids to unify them would churn a green suite for a consistency
no user can see. See [research.md §4](../research.md).

## 3. Descriptor deltas (`packages/core/src/config/settings-metadata.ts`)

```ts
// terminals.flavours — was `control: 'array'` (:159-166)
{ key: 'terminals.flavours', label: 'Custom terminal flavours', group: 'Terminals',
  control: 'records', idKey: 'id', itemNoun: 'flavour', clearable: true,
  columns: [ { key: 'label',         label: 'Label',          control: 'text' },
             { key: 'file',          label: 'Executable',     control: 'text' },
             { key: 'args',          label: 'Arguments',      control: 'text' },   // string[] ↔ space-separated
             { key: 'defaultParams', label: 'Default params', control: 'text' } ] }

// terminals.disabledBuiltins — was `array` + `itemControl: 'text'` (:167-175)
{ key: 'terminals.disabledBuiltins', label: 'Hidden built-in flavours', group: 'Terminals',
  control: 'multiselect', clearable: true }        // options are DYNAMIC — see contracts/terminal-flavours-ipc.md

// editor.openOnClick — key UNCHANGED, group and label change (C2 / FR-024)
{ key: 'editor.openOnClick', label: 'Open files with', group: 'File Explorer',
  description: 'Which file-tree click opens a file into the last active editor.',
  control: 'select', allowedValues: ['single', 'double', 'none'] }

// explorer.openMode — DELETED (C1 / FR-023)
```

**C2 rationale, in the code**: a descriptor's Preferences section comes from its explicit `group` field
(`metadata.ts:65`), **not** from its key prefix. So the working setting appears exactly where users look
for it while keeping the key 006 chose — which already has consumers, tests and specs pointing at it.
Discoverability of the inert control, behaviour of the working one, **no key rename and therefore no
migration of a setting that works**. Its `none` value is retained and becomes visible.

## 4. `explorer.openMode` — deleted, not migrated (C1 / FR-023)

**MUST** remove, in `packages/core/src/config/app-settings.ts`:

| Site | Line | Action |
|---|---|---|
| `ExplorerSettings.openMode` | `:21` | delete the field |
| `DEFAULT_APP_SETTINGS.explorer.openMode` | `:199` | delete the default |
| `explorerSettings(...)` parse | `:269-270` | delete the branch — an unknown key is then dropped by the existing tolerant parse |
| `cloneExplorer(...)` | `:291` | delete the copy |
| `OpenMode` type | `:14` | its last user is `decideClick`; see below |
| the descriptor | `settings-metadata.ts` | delete |

**MUST**: retype `decideClick(openMode: OpenMode, …)` (`open-intent.ts:17`) to the type it is actually
fed — `EditorOpenOnClick` (`'single'|'double'|'none'`) — and stop naming the parameter after the setting
that never fed it. **That parameter name is how #95 hid**: a search for `explorer.openMode`'s consumer
appears to find one. The `'none'` case is already handled by an early return upstream
(`tree-node.tsx:47-49`), so the function's behaviour is unchanged.

**MUST NOT**: migrate, reinterpret, or warn. The values are not compatible (`editor.openOnClick` has
`none`; `openMode` does not), so a migration must invent an intent the user never expressed — and since
`explorer.openMode` has **never had any effect**, a user with `openMode:'double'` gets single-click
*today*. Migrating would **change** their behaviour; dropping preserves exactly what they have.
Idempotent by construction (constitution v3.5.0): nothing is transformed, so every load converges.

## 5. Validation (FR-019) — `packages/core/src/terminal/flavour-record.ts` (NEW, pure)

```ts
export function validateFlavourRecord(
  record: Partial<UserFlavour>, existingIds: readonly string[],
): string | null;
```

| Rule | Message MUST contain | Clarification |
|---|---|---|
| id required | `id` | it keys the dropdown **and** `terminals.defaultParams` |
| id duplicates an existing one | `already` | two flavours claiming one id have no defined winner *in the editor*; downstream, `mergeFlavours`'s `dedupeById` silently keeps the first and the user's entry disappears from the dropdown. The same message flags a duplicate that arrived **from the file** (C17) — the rule is one rule, reported at both entry points |
| executable required | `executable` | **C12**: non-empty, **not** existence-checked — a path may be valid on another machine, and launch already says *"not available on this machine"* |

A **message, not a boolean** — "invalid" with no reason is a dead end for a user who cannot see the rule.

## 6. Completeness & the #95 guard

- `assertEveryKeyDescribed` stays satisfied in both directions: the key and its descriptor are deleted
  **together** (constitution v3.11.0).
- `settings-open-on-click-single-owner.test.ts` then passes **structurally**: exactly one claimant is
  rendered (`explorer.openMode` is gone), and the survivor has real readers outside the config layer
  (`file-tree.tsx:270`, `tree-node.tsx:47-49`) — the test excludes `app-settings.ts`,
  `settings-metadata.ts` and `metadata.ts` precisely because a mention there proves only that a setting
  **exists** (`:41`, `:50`).

## 7. Observable contract

| Journey | Expectation | Test |
|---|---|---|
| Prefs, `flavours` seeded with one record | no `TEXTAREA`; `flavour-row-my-wsl` visible; `flavour-cell-my-wsl-label` = `WSL: Ubuntu`; `-file` = `wsl.exe` | RED (`:154-182`) |
| add with an empty id | `flavour-error` contains `id` | RED (`:196-198`) |
| add a duplicate id | `flavour-error` contains `already` | RED (`:202-205`) |
| add a valid id | `flavour-row-my-git-bash` appears; `flavour-error` contains `executable` | RED (`:207-215`) |
| fill its `file` cell | `settings.json` `terminals.flavours[id=my-git-bash].file` matches | RED (`:217-223`) |
| enumerate Preferences | **exactly one** open-on-click claimant, and it has a reader | RED (`:91-109`) |
| **two file-authored flavours sharing one id** (hand-seeded `settings.json`; reachable — the JSON tab ships and `parseTerminals` does not dedupe) | **both** rows render **in file order**; addressed `flavour-row-<id>` and `flavour-row-<id>-1` (**`rowKey`**, §2); the second carries the "already" message in its **own** `flavour-row-error-<id>-1` cell. **Neither row may vanish** | **NEW — T041a** (C17). §2's `rowKey` suffixing and the row-error cell exist **solely** for this journey, so without this row the contract's newest obligations have no observable statement |
| **"Default flavour parameters"** cell | renders `input[type="text"]`, **not** an empty `<select>`; a typed value reaches `settings.json` | **NEW — T040** (C14 — zero coverage today, so the test *is* the deliverable) |
| **File Explorer** group, after the move | shows *"Open files with"*; **no** second open-on-click control anywhere; `none` is offered; a hand-written `explorer.openMode` changes **nothing** and warns **nothing** | **NEW — T048** (C1/C2 — the guard test is pure and cannot see discoverability, which is the whole of C2) |
