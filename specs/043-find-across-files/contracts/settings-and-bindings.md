# Contract: settings, key bindings and tokens

**Feature**: 043

Every configurable thing this feature adds, with the exact registration each one needs. The
completeness tests fail in **both** directions, so an entry missing here is a build failure rather than
a review comment.

---

## Settings — eight leaves on `search`

The section already exists (`SearchSettings`, `packages/core/src/config/app-settings.ts:443`), and
`search.asYouTypeDebounceMs` is the sibling to copy.

| Key | Type | Ships as | Requirement |
|---|---|---|---|
| `search.inFiles.openTarget` | `'lastActive' \| 'new'` | `'lastActive'` | FR-021 |
| `search.inFiles.trigger` | `'run' \| 'asYouType'` | ~~`'run'`~~ → **`'asYouType'`** | FR-043a, FR-043b, **FR-074** |
| `search.inFiles.settleMs` | number | ~~`250`~~ → **`500`** | FR-043b, **FR-075** |
| `search.inFiles.defaultGrouping` | ~~`'file' \| 'folder' \| 'fileAndFolder'`~~ → **`'file' \| 'fileAndFolder'`** | `'file'` | FR-033a, **FR-073** |
| `search.inFiles.rememberGrouping` | boolean | `true` | FR-033b |
| `search.inFiles.warnIrreversibleCommit` | boolean | `true` | FR-057c |
| `search.inFiles.summaryNoticeMode` | `'never' \| 'timed' \| 'dismiss'` (`DisplayMode`) | `'dismiss'` | **FR-082**, FR-082b |
| `search.inFiles.summaryNoticeTimeoutMs` | number, 3000–30000 | `5000` | **FR-082**, FR-082b |

> **Amended (2026-09-09) — round two.** Three cells above moved and the superseded values are struck
> rather than deleted, so what shipped in round one stays readable:
>
> - **`trigger` ships `'asYouType'`** (FR-074). Explicit run remains available and remains the
>   alternative.
> - **`settleMs` ships `500`** (FR-075). This is Find in Files' own interval; the find bar's separate
>   `search.asYouTypeDebounceMs` is unchanged at 120 ms, which is the whole reason they are two keys.
> - **`defaultGrouping` offers two values** (FR-073). `'folder'` is withdrawn. Removing it from
>   `FIND_IN_FILES_GROUPINGS` — the array this table's type column describes and the descriptor's
>   `allowedValues` points at — is the entire migration: `bounds-guard.ts`'s `correctScalar` already
>   substitutes the default for anything outside the set, so a stored `'folder'` reads as `'file'`
>   with no coercion written by hand (research R25, plan D3).
>
> **The shipped default reaches an installed build only through the `SHIPPED_DEFAULTS_VERSION` 6 → 7
> bump** (research R28, plan D1). `seed()` writes the *materialised* settings document, so changing
> the constant alone reaches fresh installs and nobody else — and no test in this repository can see
> that, because every run starts from an empty config root. This file is the registration contract,
> not the migration; the migration is **`tasks.md` §11.1** (T120–T125), reasoned in `plan.md`'s
> decision **D1** and research **R28**.

> **Amended (2026-09-10) — round three.** Two rows ADDED, and the heading above moves from six to
> eight. FR-082 gives the replace summary notice (FR-058) its own display mode and its own timeout,
> and this table is the count FR-059's own table and FR-076's parenthetical were amended to agree
> with — a feature that asserts six in one artifact and eight in another is asserting a number its
> own contract denies.
>
> Both use the application's existing display vocabulary rather than a parallel one: `DISPLAY_MODES`
> and `DISPLAY_MODE_LABELS` from `notice/display-mode.ts` are what the descriptors point at, and the
> bounds are that module's `TIMEOUT_MIN_MS`/`TIMEOUT_MAX_MS` with a 500 ms step — on which 5000 is
> exactly a stop (3000 + 4 × 500).
>
> **`dismiss` with a stored 5000 is not self-contradictory.** It is what `error` and `warning` already
> ship: a timeout is stored for every severity whatever its mode, so switching to *Display for* never
> presents an empty control, and it is consulted only under `timed`.
>
> **No `SHIPPED_DEFAULTS_VERSION` bump for these two**, and the reason is the one version 7's own
> comment records: absence is not malformation. `parseAppSettings` supplies the descriptor default
> for a key that is not on disk, so an install with no `summaryNoticeMode` reads `dismiss` by the
> ordinary path. A bump exists to move a value the user ALREADY HAS, and there is no such value —
> version 7 has never shipped, so no released install holds a materialised `search.inFiles` section
> at all.

Eight keys, eight preferences — FR-059 enumerates all eight. `settleMs` gets its own key rather than sharing
`search.asYouTypeDebounceMs`, whose 120 ms is tuned for re-scanning one buffer rather than walking
5,000 files.

**Why a stale cell here is worse than anywhere else.** The paragraph at the top of this file says an
entry missing from it is a build failure rather than a review comment — which is exactly what makes a
*wrong* entry dangerous: the completeness tests check that every key is described, not that the
description is true. A stale "Ships as" column passes every gate and misleads every reader. This was
the fifth carrier of these defaults and the one nothing moved; it is named here so the next default
change starts by counting the carriers.

**Registration, per key** (R16):

1. Typed leaf on `SearchSettings` — `app-settings.ts:443`
2. Default in `DEFAULT_APP_SETTINGS` — `app-settings.ts:551-553`
3. Tolerant parse in `searchSettings()` — `app-settings.ts:627`. **No hand-written clamps**; bounds
   come from the descriptor, and `bounds-guard.ts:142` enforces `allowedValues` on read.
4. `structuredCloneSettings` — **a change IS needed, and getting this wrong aliases the defaults.**
   The keys are `search.inFiles.*`, so `search` acquires its first object-valued member: the existing
   `search: { ...s.search }` is a shallow spread, so every caller would receive **the same `inFiles`
   object** — which on the defaults path *is* `DEFAULT_APP_SETTINGS.search.inFiles`. Re-clone the
   nested object. `cloneEditor` (`app-settings.ts:899-903`) documents this exact trap.
5. Descriptor in `SETTINGS_METADATA`, ~~`group: 'Search'`~~ → **`group: 'Search · Find in Files'`**
   (FR-076, amended 2026-09-09 with T169) — `settings-metadata.ts`. The find bar's own
   `search.asYouTypeDebounceMs` moves to `'Search · Find Bar'` in the same change: the undivided
   `Search` section no longer exists, so a step naming it would send its next reader to a group they
   cannot find.
6. **Bump `SHIPPED_DEFAULTS_VERSION`** — `shipped-defaults.ts:65`. Without it an existing install never
   materialises the new keys, and fresh-install E2E can never see the gap.
7. A reader outside the config layer — proved by `settings-inertness-043.test.ts` (below).

**Gates**: `settings-metadata.test.ts:22` (every leaf described, no unknown keys, both directions);
`reset-completeness.test.ts:22`; `slider-descriptors.test.ts` (a control declaring `min`+`max` must be
a slider — applies to `settleMs`).

**FR-059a is not free.** No fleet-wide inertness guard exists (#108). This feature writes
`packages/core/tests/unit/settings-inertness-043.test.ts` naming all eight keys, copying
`settings-inertness-040.test.ts`'s shape: a hand-listed `NEW_KEYS` array walking every
`packages/*/src/**.ts(x)` with the config layer excluded.

---

## Key bindings — two actions

| Action id | Chord | Scope | Requirement |
|---|---|---|---|
| `search.findInFiles` | `Ctrl+Shift+F` | `EVERYWHERE` | FR-028, FR-029 |
| `search.replaceInFiles` | `Ctrl+Shift+H` | `EVERYWHERE` | FR-029, FR-029d |

**Both chords are free** — exhaustively checked against `WINDOWS_BINDINGS`
(`keybindings.ts:246-368`); the only shipped `Ctrl+Shift+*` chords are `` Ctrl+Shift+` ``,
`Ctrl+Shift+T`, `Ctrl+Shift+S` and the terminal scroll pair. `Ctrl+F`/`Ctrl+H` do not collide —
`chordCollisions` compares normalised token equality, so `Ctrl+F ≠ Ctrl+Shift+F`.

**No reserved-key exception is needed.** Neither appears in the reserved or shadowable tier, and the
enforcing test matches exact normalised tokens, so its exhaustive-list assertion stays green.

**Registration, per action** (R13):

1. `ActionId` union — `keybindings.ts:56-62` (beside the existing `search.*` block)
2. `COMMAND_SCOPES` — `:158`. There is **no default**; the completeness test fails without an entry.
3. Shipped chord in `WINDOWS_BINDINGS.bindings` — `:246-368`
4. Descriptor via `chord()` — `keybindings-metadata.ts:17` (scope is **read** from `COMMAND_SCOPES`,
   never restated)
5. `WINDOW_HANDLED_ACTIONS` — `app.tsx:182-206` and the `switch` at `:314`

**The trap.** Both are `Ctrl+Shift+<letter>` and land in `app.tsx:287`'s `keepShift` branch — the one
that made `Ctrl+Shift+T` arrive at the resolver as `Ctrl+T` and be silently inert until it was widened.
`window-chord-manifest.test.ts:49-63` discovers such chords from `app.tsx` and requires each to be
covered in `window-chord-resolution.e2e.ts`'s `COVERED` map. **Adding the binding without the coverage
entry fails the build**, which is the desired outcome.

---

## Dispatch scope — a fourth value

```ts
export type DispatchScope = 'editor' | 'terminal' | 'explorer' | 'findInFiles';
```

`keybindings.ts:142`. `scopeFromKind` (`renderer/keybindings/scope.ts:62-66`) maps the new panel kind
explicitly; `PANELS` (`:151`) widens to include it where the spec says the new panel offers a `PANELS`-
scoped action.

**Why this is required rather than tidy** (R14): today an unknown kind falls through to `'explorer'`.
Left alone, a focused Find in Files panel would make `file.cut`/`file.copy`/`file.delete`/`file.undo`
live **over the file tree's selection** while `search.find` is dead — a user pressing Delete in a
results panel could delete a file.

---

## Theme tokens

**Colour tokens: none added.** FR-044 reuses the three 013 already ships —
`searchMatch`, `searchMatchCurrent`, `searchMatchCurrentBorder` (`theme.ts:264-266`), documented as
"one pair of surfaces shared by the editor and the terminal". A result row's highlight is that same
idea on a third surface, and a new token would need the justification `editorStatusStripBg` records for
not reusing `statusBarBg`.

**Icon tokens: two added.** The convention is explicit that a new token means a **new action**, never a
glyph reused for a second meaning.

| Token | For |
|---|---|
| `findInFiles` | The explorer-toolbar control (FR-029a) and the folder context-menu item (FR-029b) |
| `searchScope` | The panel's editable scope control (FR-030) |

**Registration, per icon token**: the token and default glyph in `theme.ts`'s `icons` record; hand-
written copy in `theme-copy.ts` (`theme-copy.test.ts` rejects abbreviations, self-referential
descriptions and bare-property labels); a value in **every** bundled theme
(`default-themes/index.ts`); and the **token-count assertion** at `default-themes.test.ts:94` updated.
`areaForToken` routes `icons.*` to the Icons area for free, and `descriptorForThemeToken` gives it
`control: 'icon'`, so the preferences editor exposes it with no renderer change.

**Bump `SHIPPED_DEFAULTS_VERSION`** for these too — same reason as the settings.

---

## Menu items

Every item declares a `section` from the closed vocabulary; `section` is a **required field** on
`MenuAction`, so omitting one is a compile error rather than a review comment.

| Item | Menu | Section |
|---|---|---|
| Find / Replace / Replace All | owning panel's menu (FR-015) | `content` |
| Find in Files | folder context menu (FR-029b) | `navigate` |
| *(none for `search.replaceInFiles`)* | — | FR-029d: no second toolbar control and no second context-menu item. It is a chord only; the panel-level action with a menu item is the replace **toggle** below |
| Run / Cancel | Find in Files panel menu (FR-025a) | `viewState` |
| Toggle replace | Find in Files panel menu | `viewState` |
| Switch grouping | Find in Files panel menu | `viewState` |
| Collapse all / Expand all | Find in Files panel menu | `viewState` |
| Change scope | Find in Files panel menu | `navigate` |
| Replace All / Replace in file / Replace match | Find in Files panel menu (FR-049) | `content` |

Chords render via `firstBinding(kb, action)` on `MenuAction.shortcut`. **A new menu builder must be
added to `menu-sections.test.ts`'s import list** (`:28-37`) or it is never checked.
