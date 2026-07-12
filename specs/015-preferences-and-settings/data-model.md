# Phase 1 — Data Model: Granular Reset Controls

This feature introduces **no new persisted state**. Every entity below is either an existing one it consumes, or a derived (computed) value it evaluates at render time. The config files on disk keep exactly the shape feature 010 defined.

---

## Consumed entities (existing — not modified)

### `ShippedDefaults` (`@throng/core`, feature 010)

The frozen, authoritative record of what the app ships:

| Field | Type | Notes |
|---|---|---|
| `version` | `number` | Applied-defaults marker version |
| `settings` | `AppSettings` | Every setting leaf at its shipped value |
| `keybindings` | `Keybindings` | `bindings: Record<ActionId, string[]>` — the shipped chord set per action |
| `themes` | `Record<string, Theme>` | The 14 built-ins; their names are the *reserved* names |

Built by `buildShippedDefaults()`; deep-frozen. **This is the single authoritative answer to "what did this ship as"** — after FR-011a, no other source of defaults exists in the app.

### `ShippedDefaultsService` (UI-main, feature 010)

| Operation | Signature | Result |
|---|---|---|
| `resetBinding` | `(action: string) => Promise<ResetOne>` | `{ ok, reason?: 'no-default' }` |
| `resetSetting` | `(path: string) => Promise<ResetOne>` | `{ ok, reason?: 'no-default' }` |
| `resetEverything` | `() => Promise<RestoreResult>` | `{ ok: true }` \| `{ ok: false, failedPath, error }` |
| `restoreTheme` | `(name: string) => Promise<RestoreResult>` | feature 014's — consumed by the per-tab reset on Themes |
| `restoreAllThemes` | `() => Promise<RestoreResult>` | feature 014's — themes-only |

All writes go through `FileConfigStore.writeFilesAtomic` (stage → atomic rename → rollback on first failure, reporting `failedPath`). Atomicity is **feature 010's guarantee**, consumed not rebuilt.

---

## Derived value (new)

### `OverriddenState` — computed, never stored

The "modified" state of one row. It **is** the reset affordance's visibility condition (FR-004a): the affordance appears iff the item is overridden, and disappears the instant it matches its shipped value.

| Kind | Identity | Overridden iff |
|---|---|---|
| **Setting leaf** | full dotted path (e.g. `editor.autoSave`) — already the row's key in `SETTINGS_METADATA` | the value at that path differs (deep equality) from the same path in `shipped.settings` |
| **Key binding** | `ActionId` (e.g. `search.find`) — already the row's key in `KEYBINDINGS_METADATA` | the **normalized chord set** differs from the shipped set |

**Chord-set normalization (FR-004b)** — the load-bearing rule:

- Compare as a **set**, not a sequence: `["Ctrl+F", "F3"]` and `["F3", "Ctrl+F"]` are the same binding.
- Compare **case-insensitively**: `ctrl+f` ≡ `Ctrl+F`.
- An action that **ships unbound** has an **empty** shipped chord set — a shipped value like any other. Binding it makes it overridden; resetting it clears the binding back to unbound.
- An entry with **no shipped counterpart at all** (absent from the record — e.g. an unknown key hand-added in JSON) is **not resettable**, and no affordance is offered.

Consequence: a binding that fires on exactly the shipped chords is never reported as modified, so no reset is ever offered that would produce no visible change (SC-013).

**Why it is not stored**: it is a pure function of (current config, shipped record), both already in memory in the renderer. Caching it would add a staleness bug class for no measurable gain across ~64 rows (research D4).

---

## Identity & the reset arguments

The row keys the editors already use **are** the arguments feature 010's API expects — no mapping layer is needed:

| Editor | Row key | Feeds |
|---|---|---|
| `settings-tab.tsx` | `d.key` = full dotted path | `resetSetting(path)` → `resetSettingValue(current, path, shipped)` |
| `keybindings-tab.tsx` | `d.key as ActionId` | `resetBinding(action)` → `resetBindingValue(current, action, shipped)` |

---

## Retired entity (FR-011a)

### `theme-reset.ts`'s editor-compiled defaults — **deleted**

`resetCurrentSettings()` → `DEFAULT_APP_SETTINGS`, `resetCurrentKeybindings()` → `DEFAULT_KEYBINDINGS`, `resetCurrentTheme()` → `ALL_DEFAULT_THEMES`, and `isBuiltInTheme()` → `ALL_DEFAULT_THEMES` constitute the app's **second** notion of "shipped default". They do not consult `buildShippedDefaults()`, and they have already drifted from it once — feature 014 found that `ALL_DEFAULT_THEMES` lacks throng's bundled `iconPack`, so the per-tab reset and the per-row restore silently produced *different* themes, and re-pointed the Themes branch at the record to fix it. `resetCurrentTheme` is consequently already dead code.

This feature completes that collapse: the Settings and Key Bindings branches move onto the record, `isBuiltInTheme` gives way to `isReservedThemeName` (which reads the record), and the superseded helpers are deleted. **After this feature, no code path resolves a default from anywhere but feature 010's record** (SC-009).

`revertAll` / `OnEntrySnapshot` are **not** retired — they back the session undo, which is a different concept entirely and survives unchanged (FR-012).

---

## New theme tokens (FR-009c)

| Token | Purpose | Copy required |
|---|---|---|
| `editJson` | The mode toggle's glyph when it will switch to JSON editing | Yes — `THEME_TOKEN_COPY` entry |
| `editVisual` | The mode toggle's glyph when it will switch back to the visual editor | Yes — `THEME_TOKEN_COPY` entry |

Both are added to the `icons` block of the theme model and to the token-copy registry, so the v3.11.0 configuration-editor completeness test (every token has exactly one descriptor) stays green and the Themes editor exposes them automatically.

Reused tokens (no additions): `retry` (per-item + per-tab reset), `restoreAll` (global reset), `dismiss` (settings-search clear), `destroy` (chord-pill remove).

---

## Amendment 2026-07-12 — the row affordance model (FR-015 – FR-018)

### `EntryState` — computed, never stored (new, alongside `OverriddenState`)

The per-item **revert** affordance needs a second predicate, and it is deliberately the same shape
as the overridden-test with one thing swapped: what it compares *against*.

| Predicate | Compares the current value against | Answers | Drives |
|---|---|---|---|
| `isSettingOverridden` / `isBindingOverridden` | feature 010's **shipped record** | "what does Throng ship?" | **reset** |
| `settingDiffersFromEntry` / `bindingDiffersFromEntry` | the **on-entry** document | "what did I open this window with?" | **revert** |

Both live in `core/src/config/overridden.ts`; both address a setting by dotted path (own-properties
only) and a binding by **normalized chord set** (order- and case-insensitive).

They are not interchangeable, and the case that proves it is a user who arrives with an item
**already overridden**. Their starting point is that override. Reverting must return them to it —
not to the factory value, which they had already rejected before the window opened.

Consequence worth stating: a **reset** is itself a change from the on-entry state, so it leaves a
**revert** behind. A mis-clicked reset is therefore undoable, which it would not be if the two
predicates were collapsed into one.

### `FieldDescriptor.clearable` — declared, never inferred (new)

An additive optional boolean on the descriptor (`core/src/config/metadata.ts`). It declares that
**empty is a valid value for this field** — the tolerant parser accepts it and a runtime fallback
supplies behaviour in its absence.

It is **not** "the shipped default is empty". Those come apart in both directions, and the theme's
font stack is the proof: it ships **populated** and is still legitimately emptiable (FR-018).

Declared, because clearability is a property of the *field*, not of whatever the field happens to
hold today — inferring it from the current value would let a required setting become emptiable into
an invalid state the moment it happened to be a string.

`auditClearable()` holds the declaration honest: every field declaring `clearable` must round-trip
an **empty** value through the tolerant parser and come back still empty. A field whose parser
quietly substitutes a default is **not** clearable, whatever its descriptor claims. Currently
declared: `explorer.excludeGlobs`, `terminals.disabledBuiltins`, `newProject.overridePath`, and
every theme font-family token.

### Where the writes go

| Action | Path | Why |
|---|---|---|
| **reset** | `throng:config:resetSetting` / `resetBinding` (IPC → main) | only the main process holds the shipped record and can write atomically from it |
| **revert** | `throng:config:write` (the ordinary edit path) | writes a value the renderer already remembers |
| **clear** | `throng:config:write` (the ordinary edit path) | writes an empty value |

**No IPC channel was added for revert or clear.** They are edits, and an edit channel already
exists. An integration test asserts the surface never grows a `revert*`/`clear*` channel — the
main-process surface is the app's blast radius, and it should widen only when the renderer
genuinely cannot do the job itself.

### One more theme token (FR-009c amended: five, not four)

`revert` (`↶`). Clear reuses `destroy`; reset keeps `retry`. The three sit **side by side in the
same gutter**, so they must be three distinct glyphs — sharing one would make the row lie about
what the click is going to do.
