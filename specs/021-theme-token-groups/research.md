# Phase 0 — Research & Decisions

## §1 — Where grouping and search actually live

**Decision**: Both behaviours are pure `@throng/core` functions the renderer already consumes; the
feature is two edits there, not a renderer rewrite.

- **Grouping**: `descriptorForThemeToken(key)` (`packages/core/src/config/theme-metadata.ts`) returns a
  `FieldDescriptor` whose `group: string` is the section heading. The Themes tab
  (`themes-tab.tsx: groupNonIconDescriptors`) renders one `<section data-testid="settings-group-<group>">`
  per distinct group, **in registry order**; `IconSection` renders icon tokens under a fixed "Icons"
  heading. So changing the group strings + the registry order changes the rendered grouping with **no
  renderer edit**.
- **Search**: both tabs filter via core `filterFields`/`matchesQuery`, which both build their haystack
  with `fieldHaystack(field, value) = key + label + description + value`. Adding `field.group` there is
  the entire section-name-search feature, shared by both tabs at once.

**Rationale**: Least code, no duplication, matches Principle VIII (one registry, one haystack).
**Alternatives rejected**: a bespoke grouping map in the renderer (splits the source of truth from the
completeness guard); a separate section-search branch per tab (duplicates the matcher).

## §2 — `panelSurface` no longer exists (spec/issue drift)

**Finding**: Issue #84 and spec FR-014 / Edge Cases repeatedly cite `panelSurface` as the token that
"does five unrelated jobs" and should land in General. **The current theme has no `panelSurface`
token.** The colour token set is `surface`, `surfaceActive`, `menuSurface`, `inputSurface`,
`hoverSurface`, `dialogSurface`, `errorSurface` — the split of what was once one overloaded surface
(see the `theme.ts` comment: *"Until 018 this token also painted the menus, the inputs, the row…"*).

**Decision**: Read the spec's `panelSurface` as the present-day **`surface`** token (the pane/panel
body, still the most broadly-used surface). It has no single dominant area → **General**, which is
exactly FR-014's intent. No spec rewrite is required to build correctly; this is recorded here and the
completeness guard makes any real ungrouped token fail loudly regardless of its name.

**Rationale**: The requirement's *intent* (an overloaded surface token belongs in General because it
has no dominant area) is satisfiable against the token that actually exists. **Alternative rejected**:
blocking on the dead name — there is nothing to block on; `surface` is grouped, the guard passes.

## §3 — `Sub-workspace` is a required-core area with no token today

**Finding**: FR-003 lists `Sub-workspace` in the required core and FR-004 orders it, but no colour or
typography token is specific to the sub-workspace window — it reuses the shared `surface`/panel tokens.

**Decision**: Keep `Sub-workspace` as an **allowed, ordered** member of `THEME_AREA_GROUPS`; assign no
token to it today. It renders nothing (an empty group is not rendered — the renderer only emits a
`<section>` for groups that have members). The closed-set guard asserts each token's area is *in* the
set; it does **not** require every area to be *populated*, so an empty allowed area is legal.

**Rationale**: Honours FR-003's required-core list without inventing a token or mis-filing a shared one
into it (which would violate primary-area-wins). If a future feature adds a sub-workspace-specific
token, the area already exists for it. **Alternative rejected**: forcing `activePanelBorder` or a
surface into Sub-workspace — those belong to the main workspace / General; mis-filing to populate a
group is exactly what the spec's primary-area-wins rule forbids.

## §4 — Search: sub-group inclusion & case-insensitive substring come for free

**Decision**: No special handling for nested `Editor · Syntax`. Because the search is a case-insensitive
substring test and the group string of a syntax token is literally `"Editor · Syntax"`, the query
`"editor"` already matches it (FR-016). The union with name matches (FR-015) is inherent: a field
qualifies if *any* token hits *any* part of the haystack, and group is now part of the haystack.

**Rationale**: The existing OR-substring semantics already produce exactly the specified behaviour once
`group` is in the haystack; adding parsing/segmentation would be dead complexity (YAGNI).

## §5 — Impact on existing tests (measured, not assumed)

- **`theme-metadata.test.ts:52`** asserts `descriptorForThemeToken('colours.appBg').group === 'Colours'`.
  This encodes the *old* type-group and must change to `'General'`. Line 54 (`icons.terminal` → `'Icons'`)
  is unchanged.
- **Search E2E** (`preferences-settings.e2e.ts`, `preferences-row-actions.e2e.ts`): audited each query
  used against the group strings. None of the queries (`theme`, `dwell`, `600`, `theme globs`,
  `terminal`, `zzz…`) coincides with a group name in a way that changes the asserted pass/fail — e.g.
  `terminal` already matched `terminalBg` by name and still leaves `editorBg` (group `Editor`) hidden.
  So the haystack change does **not** break them. Any that did would be updated to the new behaviour,
  not worked around.
- **`settings-search.test.ts`** builds `SearchableField` objects with **no** `group` — hence `group`
  must be **optional** and the haystack must tolerate its absence (`field.group ?? ''`). New tests add
  group-bearing fields to prove section matching.
- No E2E references a theme `settings-group-Colours` / `Fonts` / `Typography:` heading, so the rename
  breaks no E2E. Theme rows are addressed by `theme-row-colours.<key>` (unchanged).

## §6 — Fold-in refactor decisions (2026-07-19)

**§6a — Byte-identical withdrawn; migration is the replacement guarantee.** Folding the refactor into
#84 (user's decision) means keys change and colours change, so FR-011 is revised and FR-012/SC-004/006
are replaced. **Decision**: a pure, idempotent `migrateTheme` runs on load and seeds bundled themes,
guaranteeing *lossless* migration (surviving tokens keep their value; new tokens derived
deterministically). **Alternative rejected**: versioned theme schemas with a migration ladder — YAGNI
for a single transition; one idempotent function covers load, reset, and bundled-seed.

**§6b — Button colour derivation.** The current UI already draws three button intents (confirm=accent,
destroy=danger, cancel=generic button/border) but through *borrowed* tokens. **Decision**: seed the 18
explicit tokens from exactly those borrowed sources (Confirm←accent/accentText, Destroy←danger/dangerText,
Cancel←legacy button*/border), so migrated and bundled themes look identical to today at rest, then are
independently tunable. This makes the refactor a *no-visual-change-by-default* consolidation, which keeps
the migration lossless and the diff reviewable. **Alternative rejected**: inventing fresh button palettes
per theme — unreviewable and not what "consolidate" means.

**§6c — Hover suppression mechanism.** The stranded hover is native CSS `:hover` persisting because an
overlay (the cog menu's Themes item) closed over the element while focus left for Preferences.
**Decision**: gate hover-background rules on main-window focus + no open child/menu, via a
`body[data-window-blurred]` flag set on `blur`/child-open and cleared on `focus` + first `pointermove`.
This satisfies "no hover unless genuinely hovering" app-wide, not just on the one reported element.
**Alternative rejected**: a JS pointerenter/leave model replacing every `:hover` — far larger surface,
and CSS `:hover` is correct *while focused*; the bug is only the blurred/stranded case. **Mechanism to be
re-confirmed with systematic-debugging before coding** (the exact focus/overlay signal may differ).

**§6d — Colour picker reuses the context-menu positioner.** The context menu already flips+clamps on both
axes pre-paint (`context-menu.tsx:313-324`); the colour picker only flips vertically. **Decision**:
extract the block into a shared `clampToViewport(anchorRect, size, viewport)` and have both use it — the
picker stops clipping, the menu is regression-guarded, and there is ONE positioner (Principle VIII).
**Alternative rejected**: a second bespoke clamp in the picker — duplication of exactly the logic that
already exists and works.

**§6e — Usage guard is data-driven, not edit-shadowed.** The guard *discovers* consumers by grepping the
built CSS var set + a small documented list of TS consumers (terminal→xterm, syntax→highlight-style),
rather than checking the files this change happened to touch — so it catches a token that loses its last
consumer anywhere, and proves the removed tokens (`menuSurface`/`dialogSurface`/legacy buttons) have zero
consumers left.
