# Tasks: Theming, Preferences & Shell Polish

**Feature**: `018-theming-prefs-and-shell-polish` | **Input**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

## Test layers in THIS repository

Tasks are written to the layers that **exist**, not to ones that would be convenient:

| Layer | Where | What it can cover |
|---|---|---|
| **unit** (vitest) | `packages/core/tests/unit/`, `packages/ui/tests/unit/` | Pure logic (tokens, fallback chains, number formatting, confinement). **Also source guards** — tests that walk the source tree and assert a property of it. |
| **integration** (vitest) | `packages/ui/tests/integration/` | Main-process behaviour against a real filesystem. |
| **contract** (vitest) | `packages/*/tests/contract/` | Abstraction contracts. |
| **E2E** (Playwright-Electron) | `packages/ui/tests/e2e/` | Everything in the renderer, through the running app. |

> **There is no component/React render test stack** (no jsdom, no testing-library). Renderer behaviour is
> proved by **E2E**, and no task pretends otherwise.

**Source guards are the highest-value tests here.** This is a *sweep*: the requirement is "every menu",
"zero un-themed surfaces", "exactly two notice models". A test that checks the three files I remember
touching will pass while the requirement is still violated elsewhere. Guards that **discover** what is in
the tree are what make a sweep true — and are how the Phase 0 survey found the dead `--danger` variable
in the first place.

---

## Phase 1: Setup

- [x] T001 Confirm the baseline is green and record it: `npm run lint`, `npm run typecheck`, `npm test` from the worktree root, capturing complete output to a scratch file. Note the one known cold-start E2E flake (`app-shell.e2e.ts:47`, issue #75, out of scope) so it is never mistaken for a regression introduced here.

---

## Phase 2: Foundational (blocks every story)

- [x] T002 Write a **source-guard unit test** in `packages/ui/tests/unit/css-variables-defined.test.ts` that walks every renderer file — **`.css` AND `.ts`/`.tsx`** — extracts every `var(--name)` reference, and asserts each name is either defined in a `:root` block or emitted by `toCssVariables()` in `packages/core/src/config/theme.ts`. It MUST fail on `--danger` today.

  > **Walk the TypeScript too.** FR-051b says "every custom property referenced **anywhere in the renderer**", and there are live `var()` references in `.tsx` (e.g. `var(--throng-zoom-editor)`, `var(--throng-font-editor-family, …)`) that a CSS-only walk cannot see. **A guard narrower than the requirement it implements is the exact failure this feature indicts elsewhere** — and note the "13 references across 3 files" figure came from a CSS-only search, so **let the guard produce the real count** rather than trusting that number. It may well be short.
- [x] T003 Make T002 pass: define `--danger: var(--throng-colour-danger)` in `packages/ui/src/renderer/theme.css` alongside the other aliases, repairing **every** `var(--danger)` reference the T002 guard enumerates — **not** a hand-written list of them.

  > **Take this literally.** The Phase 0 survey reported "4 references"; the analyze pass counted **13**, spread across `preferences.css`, `theme.css` **and `title-bar.css`** — a third file the first count never named. Repairing "the four" would have left nine silently rendering hard-coded literals. **Let the guard tell you the list.** This is the feature's own thesis applied to itself: a count made by hand is a count that is wrong.

- [x] T002a **Write the SC-002 colour-literal guard, and run it as a SCOUT before US1 freezes the token roster.** This task is its **sole author**; T058c later adds the inline-artwork clauses and T058d makes it pass. Run it now purely to *enumerate* what it finds. Do **not** fix anything yet.

  Write it in `packages/ui/tests/unit/no-inline-artwork.test.ts`, **quarantined (`describe.skip`)** with its findings written to a scratch note — T058d un-skips it once the repairs land. It must not leave the bar red for four phases; a red baseline that everyone learns to ignore is worse than no guard.

  It MUST walk the **whole renderer tree** — `.css` **and** `.tsx`/`.ts`, not a named subset — and flag every **hard-coded colour literal that actually paints**.

  **The predicate, precisely — and the CSS/TypeScript asymmetry is REAL, not a technicality:**

  - **A CSS `var(--token, #literal)` fallback is DEAD.** The variable emitter merges every theme over the built-in defaults before emitting, so the property is *always* defined and the fallback can never fire. ~120 of the tree's ~126 literals are these. **Allow-list them.** Banning them would fail on lines nobody is scheduled to touch, and the guard would be deleted by the first person it annoyed.
  - **A TypeScript `theme.colours.x ?? '#literal'` fallback is LIVE.** The renderer's config store merges a user theme **shallowly** — so a theme file supplying `colours: { surface: … }` and nothing else leaves `theme.colours.terminalBg` **genuinely `undefined`**, and the literal paints. **Flag them.** This is the *same defect class as FR-008*, in TypeScript rather than CSS: a partial user theme silently falls back to a hard-coded colour instead of the theme's own value.

  > That asymmetry is why the guard must walk `.tsx`. A CSS-only guard cannot see the terminal's colours at all — they are passed to xterm from TypeScript — and SC-002 claims **zero** surfaces render in a non-theme colour.

  Allow-list, with the reason written into the test: the theme's own token-definition blocks (`tokens.css`, the `:root` aliases), CSS `var()` fallbacks (dead, per above), and **`box-shadow`/`text-shadow` literals** — a drop shadow is an occlusion effect rendered *over* whatever sits beneath it, black-at-low-alpha in every theme, not a surface taking a colour from the theme (FR-014, charge (e), withdrawn on the record).

  > **This ordering is load-bearing.** T014 re-derives the theme-distinctness constant **once**, against the settled token roster. If the guard runs in US2 and discovers a painting literal that needs a **new** token, that token cannot be added without invalidating the constant US1 already derived — and the "re-derive once, not four times" plan quietly becomes false. Running the guard *first* means anything it implies lands in T009 and is priced into T014.
  >
  > The fourth analyze pass proved the point the hard way: it found the shared menu's hover foreground (`#06101f`) had **no token to land on**, which added `accentText` to the roster. A guard that ran earlier would have found that itself.

  **If the scout finds a painting literal with no token to land on** — and it may; every hand count in this feature has been wrong — then **amend the roster before US1 derives anything against it**: add the token to `contracts/theme-tokens.md` (the authority), then to T009 and T012, **before** T014 runs. That is the whole reason this task exists in Phase 2 rather than Phase 5. Do not work around a missing token by leaving the literal in place.

- [x] T002b **Scout the token call sites — resolving the ALIAS CHAIN.** Before US1 re-points anything, produce the true list of every place the pane token is read, and every place `surfaceActive` is read.

  > **The token is reached under THREE names, not two, and nobody knew.** `theme.css` defines
  > `--bg-panel: var(--throng-colour-surface, …)` and then `--surface: var(--bg-panel)` on top of it. A
  > guard that greps for `--throng-colour-surface` and `--surface` **misses `--bg-panel` entirely** —
  > including the shared menu's own background — and would report **green with fourteen references
  > unmoved**. `--bg-panel` appears nowhere in this feature's spec, plan, tasks or contract.
  >
  > This is the third time in this feature a hand-made list has been wrong, and it is the most dangerous:
  > the guard was the thing that was supposed to stop that happening.

  The scout MUST **resolve the alias chain transitively** — find every custom property that ultimately
  reads `--throng-colour-surface` or `--throng-colour-surfaceActive`, then find every reference to *any*
  of those names. Emit the call sites grouped by the CSS rule that uses them, so each can be assigned a
  role. **This output — not any table written by hand — is the input to T015–T020 and to the FR-002
  audit.**

- [x] T002c **Scout the menus.** Discover every floating list/menu surface in the renderer — do **not**
  grep for two class names.

  > **There is a third bespoke menu, and the contract already knew.** Besides the cog and Key Bindings
  > menus, `preferences.css` carries a **font typeahead list** (`.ctl__font-list`) with its own surface,
  > its own hover, no flip/clamp and no shared-menu participation. FR-013 demands *exactly one* menu
  > implementation; a guard that bans two class names sails straight past a third.

  For each surface found, it is either **the shared menu** or an **explicitly recorded exception**. Record
  the decision. (Expected: the font list is a **combobox** — a filtered value picker, not a list of
  actions — so it is not required to *be* the shared menu, but it MUST still take its colours from the
  menu tokens and MUST flip/clamp. Confirm that from the scout's output rather than assuming it.)

**Checkpoint**: the dead variable is repaired; the token roster is settled against what the tree
*actually* contains; and the call-site and menu lists come from **discovery**, not from anybody's memory.

---

## Phase 3: User Story 1 — A theme author can colour each surface independently (P1)

**Goal**: one overloaded token becomes the distinct roles enumerated in
[`contracts/theme-tokens.md`](./contracts/theme-tokens.md) (the authoritative roster); the scrollbar,
icon-colour, accent-text and icon tokens land in the same pass.

**Independent test**: set the pane-background token to a colour deliberately wrong for a menu; the Files &
Folders pane changes and the menus, hovers, inputs and buttons do not. All bundled themes still render.

> **ALL fifteen new tokens are added in this one phase** — **10 colour** (4 surface roles + menu-item
> hover + `accentText` + 3 scrollbar + optional `iconColour`) and **5 icon** (`settings` + the 4 window
> controls). The authoritative roster is [`contracts/theme-tokens.md`](./contracts/theme-tokens.md),
> **not** any prose count. Later stories only *consume* them.
>
> This is deliberate: the distinctness constant must be re-derived **once**, not four times. Note that
> **icon tokens do not participate in the colour-distinctness metric** — only the 9 non-optional colour
> tokens move it.

### Tests (write first, watch them fail, and confirm they fail for the right reason)

- [x] T004 [P] [US1] Unit test the split-fallback chain in `packages/core/tests/unit/theme-split-fallback.test.ts`: a theme supplying only `surface` resolves `menuSurface`/`inputSurface`/`hoverSurface`/`dialogSurface` to **that theme's** `surface` — **not** to the built-in default. A theme supplying only `accent` resolves **`menuItemHoverSurface` to `accent`** (its parent — **not** `surfaceActive`; the shared menu's hover is accent-based today, and it is the menu that survives). An explicit value always wins. This is FR-008 and it is the single easiest thing in the feature to get quietly wrong. The parent table in [`contracts/theme-tokens.md`](./contracts/theme-tokens.md) is authoritative — check it, do not recall it.
- [x] T005 [P] [US1] Extend `packages/core/tests/unit/default-themes.test.ts` so every bundled theme (the 14 plus `throng`) carries a value for every new token — and so `iconColour`, which is **optional by design**, is excluded from that sweep rather than failing it.

  > **FR-005 (token-completeness) needs no task of its own**, and this note is why a reader should not go looking for one: the theme descriptor registry is *derived from the built-in theme's leaves*, so the 9 required colour tokens and the 5 icon tokens get descriptors **automatically** the moment T009 adds them. The only token that escapes that mechanism is the optional `iconColour` — and T077a is the test that covers precisely the case the derived audit structurally cannot see.
- [x] T006 [P] [US1] Extend `packages/core/tests/unit/theme-copy.test.ts` coverage to the new tokens: each has a hand-written label and description, uses none of the banned abbreviations, and is not mechanically derivable from its key.
- [x] T007 [US1] Write the **role guard** in `packages/ui/tests/unit/surface-token-roles.test.ts`, built on T002b's alias-chain resolution: after the split, the pane token — **under every name that transitively aliases it, including `--bg-panel`** — is referenced **only** by the pane/panel-body rules. Every other role uses its own token. Guard `surfaceActive` the same way; **nothing polices it today at all.**

  > **Resolve the alias chain or this guard is theatre.** Grepping `--throng-colour-surface` and
  > `--surface` misses **`--bg-panel`**, through which the majority of the call sites — including the
  > shared menu's background and the active tab chip — actually read the token. A guard that enumerates
  > two of three names is a hand-maintained list wearing the word "guard", and it would go green over a
  > violated requirement. **This guard is the only thing standing between FR-001 and a false SC-001.**

  Allow-list the theme's own token-definition blocks (the `:root` aliases, `tokens.css`), with the reason written into the test — a guard that flags the definition of the thing it polices gets deleted.
- [x] T008 [US1] Update `packages/core/tests/unit/theme-quality.test.ts` for the re-derived distinctness constant. It asserts **equality** to 2 dp, and the metric is a mean over shared tokens, so adding tokens moves it **even when every new value duplicates an existing one**. Expect this to fail on a correct change; that is the point.

### Implementation

- [x] T009 [US1] Add the fifteen tokens to `Theme`/`THRONG_THEME` in `packages/core/src/config/theme.ts` — **10 colour**: `menuSurface`, `inputSurface`, `hoverSurface`, `dialogSurface`, `menuItemHoverSurface`, `accentText`, `scrollbarTrack`, `scrollbarThumb`, `scrollbarThumbHover`, optional `iconColour`; **5 icon**: `settings`, `windowMinimise`, `windowMaximise`, `windowRestore`, `windowClose`. The roster in `contracts/theme-tokens.md` is authoritative.

  > **`menuItemHoverSurface`'s parent is `accent`, NOT `surfaceActive`** — the shared menu's hover already uses `var(--accent)`, and it is the menu that survives. **`accentText`** is the foreground that sits on it, hard-coded as `#06101f` in two places today with no token. Both facts were found in the fourth analyze pass; getting them wrong would have re-derived the distinctness constant against the wrong roster.
- [x] T010 [US1] Implement the fallback chain in `packages/core/src/config/theme.ts` and apply it **inside `toCssVariables()`, before the variables are emitted**. It MUST NOT be expressed as a CSS `var(…, fallback)`: the emitter merges every theme over the built-in defaults first, so a CSS fallback can never fire (there is a dead precedent at `theme.css:24`). `iconColour` is the exception — when unset, emit **no** property at all, so `.icon { color: inherit }` keeps binding to the host control.

  **Export ONE resolver and ONE parent map**, and route every consumer through them:

  - `TOKEN_PARENT: Partial<Record<keyof ThemeColours, keyof ThemeColours>>` — the mapping, stated once.
  - `resolveSplitColour(theme, token)` — the chain, implemented once.

  **`toCssVariables()` is not the only consumer.** The TypeScript call sites never pass through it — the **terminal panel** reads `theme.colours.*` directly (its `?? '#literal'` fallbacks are *live*, per T002a) and the **drag-ghost window** (T021) resolves colours in the main process. If the chain lives only inside `toCssVariables()`, those consumers will each grow their own copy of the fallback logic — **the precise duplication FR-008 and Principle VIII exist to prevent**, in the very change that introduces the chain.

  **Scope**: this task builds the **resolver and the map**, and routes `toCssVariables()` and the ghost window (T021) through them. **T058d owns the `terminal-panel.tsx` call-site edit** — one behaviour, one owner. Two tasks each assuming the other did it is how a file ends up edited by nobody.
- [x] T011 [US1] Derive the new tokens from their parents in `makeTheme()` in `packages/core/src/config/default-themes/index.ts` (`menuSurface: p.menuSurface ?? p.surface`, etc.), so all 14 bundled themes are **visually identical** after the split. The point of the split is that an author *can now* differentiate the roles — not that throng does.
- [x] T012 [US1] Add hand-written copy for all **fifteen** tokens in `packages/core/src/config/theme-copy.ts` — including `accentText`, which the fourth analyze pass added to the roster. The abbreviation ban applies to the **copy text**, not the key — so `iconColour` is a legal key but its description may not read "the icon colour bg token".
- [x] T013 [US1] Add the `settings` and four window-control glyphs to the `throng-svg` pack's shape map in `packages/ui/src/main/icon-pack-service.ts`, or they silently fall back to the generic shape.
- [x] T013a [US1] **Record the `surfaceActive` audit** (FR-002) in `contracts/theme-tokens.md` — **from T002b's scout output, not by hand.**

  > **The audit in the contract today is a hand count and it is WRONG.** It records **three** remaining
  > sites, all one role. The tree has **ten**, and **four of them are hover states**
  > (`.explorer-toolbar__btn:hover`, `.pane-collapse:hover`, `.settings-search__clear:hover`,
  > `.icon-button:hover`) — so `surfaceActive` **is** doing the row-hover job FR-001 orders carved out.
  > "FR-002 is discharged by one token, not four" does not survive enumeration.
  >
  > It also misfiled the **active tab chip** as a `surfaceActive` site; it reads the *pane* token.
  >
  > Rewrite the audit from the scout: the four hover sites go to `hoverSurface` (T017), the tab chip to
  > `surfaceActive` (T020a), and what genuinely remains is the selected/active role. **An audit done by
  > hand is not an audit** — that is the whole thesis of this feature, and it was violated in the
  > document that records it.
- [x] T014 [US1] Re-derive `CLOSEST_LEGITIMATE_PAIR_DELTA` and re-check `DISTINCTNESS_THRESHOLD` in `packages/core/src/config/theme-quality.ts`, and add the new **`accentText` on `accent`** pairing (plus any other new foreground/background pairing) to `CONTRAST_PAIRINGS`. **Do not relax, weaken or disable either guard** (FR-006) — re-derive the constant and record why it moved. **This runs after T002a**, so the roster is settled before the constant is derived against it.
> ### Work from T002b's scout output, NOT from the line numbers below
>
> The lists in T015–T020 are **indicative, as of authoring, and known to be incomplete.** They were made
> by hand, and the hand was wrong at least twice:
>
> - **The active tab chip** (`.tab-chip--active`) reads the pane token via `--bg-panel` and appears in
>   **none** of these tasks — though **SC-001 names it explicitly** as a surface that must stop following
>   the pane background.
> - **`theme.css:815`** was claimed by *two* tasks below, assigned to *two different* tokens.
>
> Five of these tasks edit `theme.css`, so every insertion shifts the next one's line numbers anyway.
> **T002b's scout produces the true, alias-resolved call-site list; T007's guard proves nothing was
> missed.** Assign a role to every site the scout finds. These tasks are **not `[P]`** — they edit the
> same files.

- [x] T015 [US1] Re-point the **menu** call sites to `menuSurface` (incl. `theme.css` `.context-menu`, `title-bar.css` `.cog-menu__list`, `preferences.css` `.kb-ctx-menu` and `.ctl__font-list`).
- [x] T016 [US1] Re-point the **input** call sites to `inputSurface` (project form fields, search boxes, the rename input, panel-type form controls).
- [x] T017 [US1] Re-point the **hover** call sites to `hoverSurface` — tree-row hover, key-binding-row hover, title-bar chrome hover, **and the four icon-button hovers currently reading `surfaceActive`** (`.explorer-toolbar__btn:hover`, `.pane-collapse:hover`, `.settings-search__clear:hover`, `.icon-button:hover`). Those four are a **hover** role, not a selected/active one — the FR-002 audit missed them (see T013a).
- [x] T018 [US1] Re-point the **dialog** call sites to `dialogSurface` (the modal card, the app-closing card, the capture modal, the find bar).
- [x] T019 [US1] Re-point the **menu-item hover** call sites to `menuItemHoverSurface` (cog menu item, Key Bindings menu item, font-list item).
- [x] T020 [US1] Re-point the **button** sites at the **existing** `buttonBg`/`buttonHoverBg` tokens — including `.panel-box__actions button:hover`, which an earlier draft double-assigned to `hoverSurface`. No new button token: one already ships for this role (YAGNI).
- [x] T020a [US1] Re-point the **selected/active** sites to `surfaceActive`: the selected tree row, the active panel header, the **active project row**, and **the active tab chip** — which reads the *pane* token today and is named by **SC-001** as a surface that must stop moving with the pane background. It was in none of the original re-point tasks.
- [x] T021 [US1] Update the **drag-ghost window**, a separate `BrowserWindow` that will silently drift from the theme otherwise: `packages/ui/src/main/ghost-window.ts` and the `resolveColour` calls feeding it in `packages/ui/src/main/main.ts:349-360`.
- [x] T022 [P] [US1] Add any new first-paint token to the static pre-mount fallback in `packages/ui/src/renderer/theme/tokens.css`.
- [x] T023 [US1] E2E in `packages/ui/tests/e2e/theme-tokens.e2e.ts`: setting the pane-background token changes the pane and leaves menus, hovers, inputs and buttons unchanged; setting `menuSurface` changes every menu together. **Write this with the other tests, before T009** — Phase 3's heading says "write first, watch them fail", and US1 is the one story that had its end-to-end tests sitting after the code they verify.
- [x] T023a [P] [US1] E2E: the **drag-ghost window** follows a theme switch. It is a **separate `BrowserWindow`**, visible during every panel drag, and T021 re-points its colours — a user-facing change with, until this task, **no test at any layer**. Principle V is non-negotiable, and there is already drag E2E to hang this off. (`tokens.css`, the pre-mount fallback in T022, is genuinely hard to assert — it paints for one frame before the provider mounts — and is left to the T002 variable guard, stated rather than quietly skipped.)
- [x] T024 [US1] E2E: **the FR-008 negative case.** Write a user theme file containing only `{"colours":{"surface":"#ff0000"}}`, select it, and assert the menus, inputs and hovers all render **red** — i.e. they fell back to *that theme's* `surface`, not to throng's default. If this passes while T004 is stubbed, the fallback was written in CSS and is a lie.
> **The SC-004 theme sweep is NOT here.** It asserts that every menu, **scrollbar** and icon repaints —
> but the scrollbars are applied in US3 and the cog/Key Bindings menus only join the shared menu in US2.
> Placed in this phase it could not pass. It lives in Phase 12 as **T120a**, after the code it asserts.

**Checkpoint**: US1 is independently testable. Every later story depends on it.

---

## Phase 4: User Story 6 — One way to confirm, one way to be notified (P2, sequenced 2nd)

**Goal**: nine idioms become two models.

**Independent test**: trigger a destructive confirmation from the preferences window, the themes surface
and the main window — all three present the same way. Trigger a failure in every error surface — all
notify the same way. Reset and Revert stay distinct.

> Moved ahead of US2–US5: US8's dialog and US9's rejection affordance both consume the notification model,
> and the confirmation provider must reach the preferences window before the themes surface can drop its
> rival dialog.

### Tests

- [x] T025 [P] [US6] Write a **source guard** in `packages/ui/tests/unit/notice-models.test.ts` asserting exactly **one** confirmation component and **one** notification component exist in the renderer: no `.prefs-confirm` strip, no rival preferences confirm dialog, no bespoke per-surface error-strip class, no `RestoreNotice`, no `EditorNoticeDialog`, no `AppClosePrompt`/`DirtyCloseDialog`/`UnsavedOpenDialog` components. **This guard is what makes SC-009 true** — counting by hand is how four idioms got missed in the first place.
- [x] T026 [P] [US6] Write a **source guard** asserting every existing confirmation/notification test identifier still exists in the source. **Read the identifier tables in [`contracts/notice-models.md`](./contracts/notice-models.md)** — do not retype them here. `confirm-accept` alone is asserted by 13 E2E suites, `confirm-dialog` by 8: identifiers are **preserved, not renamed** (FR-053).

  > A hand-copied list would be a hand-copied list — in the very task whose purpose is that nothing gets lost in a migration. An earlier draft of this task already dropped `confirm-overlay` and `app-close-overlay` from its retyped list. Read the contract.
- [x] T027 [P] [US6] E2E in `packages/ui/tests/e2e/notice-models.e2e.ts`: a destructive confirmation raised from the preferences window, the themes surface, the main window **and a sub-workspace window** presents identically in all four. FR-054 says the confirmation model must be available in **every** window — testing three of them tests three of them.
- [x] T028 [P] [US6] E2E: every error surface (projects, explorer, sub-workspaces, terminal exit, themes, preferences) notifies through the one model and is dismissable.
- [x] T029 [P] [US6] E2E: the **restore notice** is now dismissable (it is a stateless component with no dismiss path today).
- [x] T030 [P] [US6] E2E: an **error** notice persists until dismissed; a **success** notice auto-dismisses (FR-048b). An error that silently auto-vanishes would be worse than the bug being fixed.
- [x] T031 [P] [US6] E2E: **Reset to shipped defaults** and **Revert all** remain semantically distinct and are described distinctly (FR-052) — 015 only just landed this distinction.
- [x] T031a [P] [US6] E2E: every confirmation's decision buttons carry **text labels**, never icons (FR-049). This is the constitution's *explicit exception* to the themeable-icon rule — the label **is** the statement of the consequence being consented to — and it is the reason Decision 3 kept two models rather than collapsing to one. A sweep that iconised these buttons would satisfy the icon rule by destroying the information the dialog exists to convey.

### Implementation

- [x] T032 [US6] Extend the confirmation model in `packages/ui/src/renderer/confirm-dialog.tsx` with an optional ordered `choices` array, an optional `details` region, and pass-through `testIds`. **The binary case stays the default and keeps its exact current shape** — that is what lets 13 E2E suites keep passing untouched.
- [x] T033 [US6] Build the notification model in `packages/ui/src/renderer/common/notification.tsx`: a provider, a host, a `severity` (error persists; success/info auto-dismiss), an optional details list, and pass-through test ids. Colours from `--throng-colour-danger` — **never** the (previously dead) `--danger`.
- [x] T034 [US6] Mount **both** providers in all three windows: `packages/ui/src/renderer/composition-root.tsx` (main + sub-workspace) and `packages/ui/src/renderer/preferences/preferences-app.tsx`. The preferences window mounts neither today — which is the entire reason the rival dialog exists.
- [x] T035 [US6] Migrate the preferences **inline confirm strip** (`preferences-app.tsx:214-248`) onto the confirmation model, keeping `prefs-reset-confirm*` ids and all three distinct Reset/Reset-all/Revert strings.
- [x] T036 [US6] Migrate the themes surface's three call sites onto the confirmation model and **delete** `packages/ui/src/renderer/preferences/confirm-dialog.tsx`, keeping `theme-confirm-*` ids.
- [x] T037 [US6] Migrate `AppClosePrompt` (3-way + the running-terminal details table) onto the confirmation model, keeping every `app-close-*` id. This is the highest-risk migration in the story — it gates application exit with live terminals.
- [x] T038 [P] [US6] Migrate `DirtyCloseDialog` (3-way) onto the confirmation model, keeping every `dirty-close-*` id.
- [x] T039 [P] [US6] Migrate `UnsavedOpenDialog` (4-way) onto the confirmation model, keeping every `unsaved-open-*` id.
- [x] T040 [US6] Migrate the **five** dismissable error strips onto the notification model — projects, explorer, sub-workspaces, terminal-exit, **and the themes strip the spec missed** — keeping every id, and delete their five separate CSS blocks.
- [x] T041 [P] [US6] Migrate the preferences notice strip (`reset-notice.tsx`) onto the notification model, keeping `prefs-notice*` ids.
- [x] T042 [P] [US6] Migrate `RestoreNotice` onto the notification model — it becomes **dismissable**, and sheds its hard-coded `#3a3320`/`#ffe08a`.
- [x] T043 [US6] Migrate `EditorNoticeDialog` (the modal message box the spec missed) onto the notification model as a sticky error carrying its file list, keeping `editor-notice-*` ids.
- [x] T044 [US6] Delete every superseded component and CSS block, and make the T025 source guard pass.
- [x] T044a [US6] **Finish the `--danger` job properly.** Once the strips are migrated, re-run the T002 guard: if nothing references `--danger` any more, **delete the alias** rather than leaving a defined-but-unused variable. FR-051a says "defined **or** removed" — T003 defines it so the existing call sites stop rendering literals; this task takes the other branch once they are gone. A variable that exists for nobody is the next dead variable.

**Checkpoint**: two models. US8 and US9 can now consume them.

---

## Phase 5: User Story 2 — Every menu obeys the theme (P1)

**Goal**: one menu implementation, in every window, themed, icon-bearing, edge-safe, keyboard-driveable.

**Independent test**: switch themes with the cog menu and the Key Bindings menu open — both repaint. Open
each near a screen edge — both flip. Open one, then another — the first closes.

### Tests

- [x] T045 [US2] Write the **single-menu guard** in `packages/ui/tests/unit/single-menu.test.ts`, built on **T002c's discovery**: every floating list/menu surface in the renderer is either **the shared menu** or an **explicitly recorded, justified exception**. It must **discover** them — banning two known class names would sail straight past the third one that already exists.

  > **There are three bespoke menus, not two.** Besides the cog and Key Bindings menus, the preferences
  > window carries a **font typeahead list** — which `contracts/theme-tokens.md` itself names, while FR-013
  > names only two. A guard that greps for `cog-menu__list` and `kb-ctx-menu` reports green while
  > "exactly one menu implementation" is false.

- [x] T045c [US2] Settle the **font typeahead list** on the record (FR-013), **in `spec.md` and the contract — not only in this task**. It is a **combobox** — a filtered value picker, not a list of actions — so it need not *be* the shared menu. But it MUST take its colours from the menu tokens (T015/T019 re-point it) and it MUST **flip and clamp** like every other floating surface. **Implement that flip/clamp**: it has none today, and FR-016 says *every* menu stays on-screen. A carve-out recorded only in a task is a carve-out the specification does not know about.
- [x] T045d [P] [US2] E2E: the font typeahead list **flips and clamps** at the preferences window's edges. T051 exercises "a menu" there — which the Key Bindings menu already satisfies — so without this the third floating surface is asserted by nothing.
> **The two guard tasks — T058c and T058d — live at the END of this phase, after the implementation.**
> The guard bans artwork that T055/T058/T058a are the ones removing, so it cannot pass until they have
> run. They are deliberately *not* in the Tests block above, and deliberately *not* `[P]`: an implementer
> walking this file top-down would otherwise hit a red bar and blame the wrong task.
- [x] T046 [P] [US2] E2E: the shared menu is **keyboard-navigable** — arrow keys move a roving focus, Enter activates, Escape closes. The cog menu is a list of focusable buttons **today**, so migrating it onto a menu that handles Escape only would be an **accessibility regression** (FR-013a). This test is what stops that.
- [x] T047 [P] [US2] E2E in `packages/ui/tests/e2e/titlebar-chrome.e2e.ts`: **every** icon this story re-points resolves from the theme's **icon pack** — switch packs and watch each one change. That is: the cog menu's gear, the four **window controls**, the Projects pane's **"new project"** control, the **pane collapse/expand chevrons** (T058), and the shared menu's **submenu arrow** (T053). No inline vector survives.

  > Principle V is NON-NEGOTIABLE: *"a UI change MUST NOT be marked done on the strength of unit evidence alone."* T053 and T058 are user-facing icon changes whose only other evidence is a **unit** source guard. Every icon this story touches is named here explicitly, because "the icons repaint" is exactly the kind of generic assertion that lets two of them slip through.
- [x] T048 [P] [US2] E2E: the cog menu **flips and clamps** at the right and bottom screen edges, on both axes at once in a corner.
- [x] T049 [P] [US2] E2E: opening any menu closes any other **in that window** (FR-017), and a menu **closes when its window loses focus** (FR-017a).

  > "Application-wide" was the original wording, and it hid work nobody had costed: the three window kinds are **separate renderer processes**, so a provider's menu state cannot reach across them without inter-process coordination — which nothing asked for and which buys the user nothing. Closing on window blur delivers what the phrase was actually reaching for, with one listener and no protocol.

- [x] T050 [P] [US2] E2E in `packages/ui/tests/e2e/preferences-keybindings.e2e.ts`: right-clicking a bound chord opens the **shared** menu, and its remove action still removes the chord. **The Key Bindings menu has ZERO E2E coverage today** (FR-019) — this is its first.
- [x] T051 [P] [US2] E2E: a menu opens **and flips/clamps at the window's own right and bottom edges** in the **preferences window** (which mounts no menu provider today) **and in a sub-workspace window**. SC-005 says "every menu in **every** window — main, sub-workspace and preferences". Each is a separate `BrowserWindow` with its own geometry, so asserting the flip in one of them asserts it in one of them.

### Implementation

- [x] T052 [US2] Add keyboard navigation to `packages/ui/src/renderer/workspace/context-menu.tsx`: roving focus, arrow keys, Home/End, Enter/Space to activate, plus the `role="menu"`/`role="menuitem"` semantics it lacks. Also **close the menu on window blur** (FR-017a) — one listener in the provider, no inter-process coordination.
- [x] T053 [US2] De-literal the shared menu: `theme.css:993`'s hard-coded `color: #06101f` on item hover → the new **`accentText`** token, and `context-menu.tsx:116`'s literal `▸` → the theme's **existing** `chevron` icon token.

  > **Leave the `box-shadow` alone.** An earlier draft of this task also ordered its shadow literal de-literalled — but FR-014 **withdrew that charge on the record**, SC-002 names shadows as its one stated exception, and T002a's guard allow-lists them with the reason written in. De-literalling it would mean inventing a shadow colour token, in 15 themes, to express "black, faintly" — **after T014 has already re-derived the distinctness constant**, silently falsifying the "re-derive once" premise that the entire US1-first ordering exists to protect.
- [x] T054 [US2] Point the shared menu at `menuSurface` and `menuItemHoverSurface`.
- [x] T055 [US2] Rebuild the cog menu (`packages/ui/src/renderer/title-bar/cog-menu.tsx`) on the shared menu: **delete the inline SVG gear** and resolve it from the new `settings` icon token. It inherits flip/clamp, click-away and the single-open invariant for free.
- [x] T056 [US2] Rebuild the Key Bindings menu (`packages/ui/src/renderer/preferences/keybindings-tab.tsx:249-267`) on the shared menu, preserving `binding-context-*` ids and the exact remove-chord behaviour.
- [x] T057 [US2] Mount `ContextMenuProvider` in `packages/ui/src/renderer/preferences/preferences-app.tsx`. One line — everything it needs (settings, theme, icon packs, the stylesheet) is already in scope there.
- [x] T058 [US2] Replace the inline vectors in `packages/ui/src/renderer/panes/chevron.tsx` with the theme's `chevron` icon token (FR-014a) — a pre-existing constitutional violation, in the same class, fixed in the same pass.
- [x] T058a [US2] Replace the four inline vectors in `packages/ui/src/renderer/title-bar/window-controls.tsx` with the new `windowMinimise`/`windowMaximise`/`windowRestore`/`windowClose` icon tokens, and the hard-coded `＋` glyph in `packages/ui/src/renderer/sidebar/projects-panel.tsx:353` with `<Icon token="add" />` (FR-014b). **Without this, SC-002 — "no icon draws from an inline vector" — is false on the day it ships.** These were originally deferred; the analyze pass caught that the deferral contradicted the feature's own success criterion.
- [x] T058b [US2] Verify (and cover, if absent) that the shared menu **already** flips/clamps at screen edges and enforces the single-menu-open invariant, which T055 relies on the cog menu inheriting "for free". The Phase 0 survey found it does — `context-menu.tsx:160-171` flips and clamps on both axes, and the provider holds one menu state so opening any menu replaces any other — but T048/T049 assert behaviour no task *builds*, so the assumption must be confirmed rather than trusted (FR-016, FR-017).

### The guards — run these LAST, after everything above

- [x] T058c [US2] **Extend the T002a guard** with its remaining clauses (T002a authored it; this task does not rewrite it). The guard's three clauses are:

  **(a) No inline `<svg>`/`<path>` artwork in any renderer component** — added here. Only three exist (`chevron.tsx`, `cog-menu.tsx`, `window-controls.tsx`), and T055/T058/T058a remove all three — which is exactly why this runs after them.

  **(b) No hard-coded colour literal in value position** — **authored by T002a**, not restated here. It is the clause the scout ran early, so the token roster could absorb whatever it found.

  **(c) Exactly one shipped SVG icon set** (FR-028) — added here. No black/white variant directories. A prohibition with no guard is a prohibition nobody notices being broken.

- [x] T058d [US2] Fix the painting colour literals the guard enumerates, then **un-skip it** (T002a left it quarantined). This task is the sole owner of un-skipping. **Let the guard produce the list**; do not work from this line — that is the whole point of having one.

  > **Every literal the scout found must already have a token to land on.** T002a's scout runs in Phase 2 precisely so that a literal needing a *new* token can be added to the roster **before T014 re-derives the distinctness constant**. If a literal reaches this task with no token, the ordering has already failed — go back, do not invent a token here.
  >
  > Note `#06101f` — the `accentText` role — occurs in **four** places, not the two the contract claimed (another hand count, wrong again). T053 de-literals one; this guard finds the rest.

  Two known classes it will find:
  - `panel-type/panel-type.css:95` — `color: #fff !important`, a real text colour. It lands on `buttonText` or `accentText` depending on what it sits on; the scout's output says which.
  - `terminal/terminal-panel.tsx:36-39` — `theme.colours.terminalBg ?? '#0c0f16'` and friends. **These are live, not dead**: the config store merges a user theme *shallowly*, so a partial theme leaves the token `undefined` and the literal paints. Resolve them through the **same fallback chain FR-008 introduces** (theme → built-in default), never a literal. This is FR-008's bug wearing a TypeScript coat.

**Checkpoint**: one menu, everywhere — and a guard that will not let a second one back in.

---

## Phase 6: User Story 3 — Scrollbars are part of the theme (P2)

**Goal**: every scrollable surface uses theme colours. The terminal keeps its geometry.

**Independent test**: scroll every scrollable surface on each theme — track, thumb and hover are theme
colours. Then resize a terminal and confirm the last column is still not overlapped.

- [x] T059 [P] [US3] E2E in `packages/ui/tests/e2e/scrollbars.e2e.ts`: on a bundled theme, the track, thumb and thumb-hover of the preferences panel, the file tree, the editor, the project list and a menu all resolve to theme tokens.
- [x] T060 [P] [US3] E2E: **the one that matters** — with the terminal's scrollbar recoloured, terminal text still wraps **before** the bar and the final column is never overlapped. The bar must remain a classic, non-overlay bar occupying real layout width: xterm's fit calculation depends on it (FR-011). This story recolours it; it must not move it.
- [x] T061 [US3] Apply the scrollbar tokens **globally** in `packages/ui/src/renderer/theme.css` (`::-webkit-scrollbar` track/thumb/hover plus `scrollbar-color`), not piecemeal per surface (FR-010).
- [x] T062 [US3] Recolour the terminal's existing rule in `packages/ui/src/renderer/terminal/terminal.css:28-43` to the new tokens — including the **track**, which is a literal `transparent` today (a third hole the spec did not count). Keep `width: 12px` and the non-overlay geometry **exactly** as they are.

---

## Phase 7: User Story 4 — The colour picker is themed and keyboard-usable (P2)

**Goal**: no operating-system dialog. A themed, keyboard-driveable picker that validates.

**Independent test**: open a colour swatch on a dark theme — the picker is drawn from theme tokens. Drive
it entirely from the keyboard. The colour still applies live and persists.

- [x] T063 [P] [US4] Unit test hex parsing/validation in `packages/core/tests/unit/colour.test.ts`: valid 3- and 6-digit hex accepted; `zzz`, empty and overlong rejected. **Today there is no validation at all** — `zzz` is written straight into the theme file on disk. This is a bug fix, not a preserved behaviour (FR-026).
- [x] T063a [US4] Create the module this test names: `packages/core/src/config/colour.ts` — a **pure** hex validator/parser, in `@throng/core` so it is unit-testable without a DOM. T071's renderer control **consumes** it rather than re-implementing validation.

  > **T063 named a module no task created.** The renderer has no component-test stack, so a validator living only in the renderer cannot be unit-tested at all — the test would have had nowhere to point. This is the same defect class as T099a and T117a: a test asserting something nobody builds.
- [x] T064 [P] [US4] E2E in `packages/ui/tests/e2e/colour-picker.e2e.ts`: clicking a swatch opens a **themed** picker and **no operating-system dialog** appears.
- [x] T065 [P] [US4] E2E: the saturation/value area, the hue control and the hex field all drive one value and agree; the colour applies live and persists.
- [x] T066 [P] [US4] E2E: an invalid hex is **rejected**, the last valid colour stands, and the error shows on the row.
- [x] T067 [P] [US4] E2E: the picker is fully **keyboard-operable** with a visible focus indicator on every control; Escape closes it and the last applied value stands.
- [x] T068 [P] [US4] E2E: **the race that must not regress** — start editing a colour, switch theme inside the debounce window, and assert the edit lands in the theme being edited, never the one switched to. The target theme is captured at edit time today (FR-023); it is the one correctness guarantee the rewrite must not lose.
- [x] T068a [P] [US4] E2E: **FR-023's second guarantee** — many rapid edits inside the debounce window compound into **exactly one** persisted write, not a race of many. FR-023 states two guarantees; T068 covers only the first, and a picker that streams values during a drag is precisely where the second one breaks.
- [x] T069 [US4] Build `packages/ui/src/renderer/common/colour-picker.tsx`: saturation/value area, hue control, hex field, all from theme tokens, all keyboard-operable with a visible focus ring.
- [x] T070 [US4] Replace `<input type="color">` in `packages/ui/src/renderer/preferences/pickers.tsx` with the new picker, preserving the `control-<key>` and `control-<key>-hex` ids.
- [x] T071 [US4] Hold **local edit state** in the hex field rather than binding it to the round-tripped theme value, and reject invalid input on the row (matching `NumberControl`'s existing `ctl__error` pattern). Today every keystroke is gated on a 150 ms write plus an IPC round-trip.
- [x] T072 [US4] Preserve the commit semantics exactly: optimistic in-memory apply, debounced write, hot-reload, **and the target theme captured at edit time**.

---

## Phase 8: User Story 5 — Icons take their colour from the theme (P2)

**Goal**: one icon set, with a theme-overridable colour.

**Independent test**: on a light theme, select the SVG pack — the icons are legible. Change the icon
colour — every icon in the application changes together.

- [x] T073 [P] [US5] E2E in `packages/ui/tests/e2e/icon-colour.e2e.ts`: setting the icon colour changes **every** icon from the pack, in every window — toolbar, tree, tabs, menus, panels.
- [x] T074 [P] [US5] E2E: with `iconColour` **unset**, icons inherit their host control's colour exactly as today — so **no bundled theme changes appearance** (FR-029). This is the test that proves the feature is invisible until asked for.
- [x] T075 [US5] Consume `--throng-colour-iconColour` in the `.icon` rule in `packages/ui/src/renderer/theme.css` so it overrides `inherit` when present and yields to it when absent. (The **emission** rule — emit only when set — belongs to T010 and is not restated here; one behaviour, one owner.)
- [x] T076 [US5] Add the icon-colour control beside the icon-pack selector in `packages/ui/src/renderer/preferences/icon-section.tsx`, using the **shared picker** from US4 (FR-025), surfaced by a **hand-authored descriptor** — following the icon-pack precedent exactly (FR-031a). It must be **clearable**, since unset is a meaningful state.

  > **This is the resolution of a real contradiction, not a stylistic choice.** The theme editor's descriptor registry is *derived from the leaves of the built-in theme*, and its completeness audit rejects a descriptor for any token that is not such a leaf. So an optional, unset `iconColour` gets **no descriptor and is uneditable** — violating the constitution's non-negotiable configuration-editor-completeness rule — while giving it a default value to make it a leaf would **break FR-029** by repainting every bundled theme's icons. The icon **pack** is already an optional, non-derived theme field surfaced by a hand-written descriptor; the icon **colour** sits beside it and works the same way. Precedent beats invention.

- [x] T077 [US5] Give the icon-colour row a searchable descriptor entry in `packages/ui/src/renderer/preferences/themes-tab.tsx` so it participates in the Themes tab typeahead, as the icon-pack row (`ICON_PACK_FIELD`) does.
- [x] T077a [US5] Write a unit test asserting **every optional theme token is reachable in the visual editor**. The derived registry's completeness audit **cannot** catch this by construction — an optional token is not a leaf, so it is invisible to the audit that exists. Without this test, an optional token could silently become uneditable and every guard in the repo would stay green (constitution: configuration-editor completeness, NON-NEGOTIABLE).

---

## Phase 9: User Story 7 — Numbers are draggable and readable (P3)

**Goal**: bounded numerics get a slider; large numbers get digit grouping; the stored value stays plain.

**Independent test**: drag a font-size slider and watch the app update; type in the field and watch the
slider follow; confirm the value on disk has no grouping characters.

- [x] T078 [P] [US7] Unit test `packages/core/tests/unit/number-format.test.ts`: `parseGrouped` is the **exact inverse** of `formatGrouped` for a comma locale **and** for a locale whose separator is `.`. A grouping character must never survive a parse. This is FR-038, and it is where a locale bug would silently corrupt a settings file. **Also assert the threshold** (FR-037): values of **five digits or more** group; values below do **not** — a 5000 ms delay must render as `5000`, not `5,000`.
- [x] T079 [P] [US7] Unit test in `packages/core/tests/unit/settings-metadata.test.ts` that **enumerates every numeric descriptor** (settings *and* theme) and asserts: every descriptor declaring `control: 'slider'` declares a min, a max **and** a step; and that the step is a **defensible fraction of its range** — not merely present. **Discover them; do not hand-list them.**

  The rule, stated so it can be failed: **`step >= (max - min) / 100`** — at most a hundred positions across the drag. Use `>=`; two shipped descriptors land at *exactly* 1.00% and must pass.

  > **"A step exists" is not the assertion that matters.** A step of 1024 across a 2 GiB range gives a slider two million indistinguishable positions — technically compliant, practically useless. That is the trap the max-file-size setting would have fallen into, and asserting mere presence would have waved it through.
  >
  > **Compute the fraction against the RANGE, not the default.** An earlier draft of this task worked its examples against the shipped default (`a 300 ms delay stepping by 50 ≈ 17%`) — a different rule from the one FR-035 states, and one under which the single genuinely-bad descriptor looks fine. The real figures: a 6–96 font stepping by 1 is **1.1%** ✓; a 0–2000 submenu delay stepping by 25 is **1.25%** ✓; a 0–10000 auto-save delay stepping by 50 is **0.5%** ✗ — **it fails, and it should**, which is why T086a exists.

- [x] T086a [US7] Widen `editor.autoSaveDebounceMs`'s step from **50 to 100** in `packages/core/src/config/settings-metadata.ts` (0–10000 range → 1.0%, exactly at the bar). It is the **one shipped descriptor that fails FR-035's rule**, and without this task T079 is a guaranteed red bar with nothing scheduled to make it green — a test asserting a rule nobody satisfies.
- [x] T080 [P] [US7] E2E in `packages/ui/tests/e2e/preferences-slider.e2e.ts`: a bounded numeric renders a slider **and** a field; each drives the other.
- [x] T081 [P] [US7] E2E: a large value **displays** grouped (`10,485,760`) and the value written to the settings file is a **plain number** — assert by reading the file.
- [x] T082 [P] [US7] E2E: **the regression that must not come back** — paste a value into the field and immediately blur it. It must commit. A stale-render defect here was a real CI flake (fixed in `78d2331`); the slider streams values continuously and must be reconciled with the field's blur/Enter commit **without** reintroducing it (FR-036).
- [x] T083 [P] [US7] E2E: out-of-bounds and non-numeric entries are rejected with the last valid value standing.
- [x] T083a [P] [US7] E2E: **the Themes editor benefits too, and does not regress** (FR-039). A theme **font weight** — newly bounded by T087 — renders slider + field, steps by 100, and persists a **plain number** to the theme file. Every other US7 test drives the *Settings* editor; FR-039 says both editors share this control and **neither may regress**, so one of them being entirely untested is not a coverage gap you can argue away.
- [x] T084 [US7] Add `slider` to `ControlKind` in `packages/core/src/config/metadata.ts`, and set `control: 'slider'` on **exactly** these, each of which declares min, max and step: the two pane max-widths; the tab-hover, submenu-hover, auto-save and search debounces; the font sizes (`fonts.baseSizePx`, the per-role `sizePx`); and the font weights (bounded by T087). **Every other numeric stays a typed field** — notably the max-file-size (T086). Theme descriptors are **derived by a field-name rule**, not hand-listed, so the slider declaration must be added to that derivation deliberately rather than assumed. **Do not touch feature 007's "exhaustive" declaration** — that reconciliation is #79 and explicitly out of scope.

  > **The slider is an explicit opt-in, not a property inferred from bounds.** An earlier draft rendered a slider for *any* numeric declaring both bounds — which made this `ControlKind` a union member nobody ever set and nobody ever read (dead code in a closed vocabulary, Principle VIII), and forced a 2 GiB ceiling onto the max-file-size setting purely so it could take a slider it should never have had. Opt-in kills both problems: the kind is load-bearing, and a value that should be typed simply is not declared a slider.
- [x] T085 [US7] Implement `formatGrouped`/`parseGrouped` in `packages/core/src/config/number-format.ts`, deriving the separator from the locale so the parser is the formatter's exact inverse.
- [x] T086 [US7] **Leave `editor.maxOpenFileBytes` typed-only, with no upper bound** (FR-034). This reverses an earlier draft that gave it a 2 GiB ceiling so it could take a slider. That was wrong twice over: a slider across 1 KiB–2 GiB has millions of positions and jumps megabytes per pixel — **worse than the text box it replaces** — and the ceiling existed to serve the control rather than because the system has one, which is precisely the invented bound FR-034 prohibits. It still gains **digit grouping** (T090), which is what actually made `10485760` unreadable.

  **Also delete its `step: 1024`.** Nothing reads a step on a typed-only field, so leaving it would be *dead metadata surviving inside the very story that exists to eliminate dead metadata* — the `step` field was declared-and-never-read, and US7 is what makes it load-bearing. If it is not load-bearing here, it should not be here.
- [x] T087 [US7] Give the theme font weights `min: 100, max: 900, step: 100` and `control: 'slider'` in `packages/core/src/config/theme-metadata.ts`. They have **no bounds at all** today, and 100–900 is the real CSS `font-weight` range — a property of the system, not a number chosen to enable a control.
- [x] T088 [US7] Render slider + field in `packages/ui/src/renderer/preferences/form-controls.tsx` for descriptors declaring `control: 'slider'`; field-only otherwise. **Read `step`** — declared by 8 descriptors and read nowhere today, it becomes load-bearing (FR-035).
- [x] T089 [US7] Reconcile the two commit paths through **one** `onCommit`: the slider commits on change (it is bounded by construction, so always valid); the field keeps its blur/Enter commit **reading the live DOM input**, not a stale render.
- [x] T090 [US7] Apply grouping to the **display** only, in `form-controls.tsx`. Both the Settings and Themes editors share this one control, so both benefit and neither may regress (FR-039).

---

## Phase 10: User Story 8 — Hidden files can be seen and un-hidden (P3)

**Goal**: a project-settings dialog, reached from the File & Folders pane.

**Independent test**: hide three paths, open the dialog, find them listed, remove one, watch it reappear.
Switch projects and see the new project's paths.

> **Renderer-only** (research C10). `setHidden` is already a full **replace**, and `hiddenPaths` is already
> in the renderer's hand. **No new IPC operation, no daemon method, no schema change.** Un-hide is
> `setHidden(id, current.filter(p => p !== target))`.

- [x] T091 [P] [US8] E2E in `packages/ui/tests/e2e/project-settings.e2e.ts`: hide three paths, open the dialog from the pane's options icon, see all three listed, remove one, and confirm it reappears in the tree **without a restart**.
- [x] T092 [P] [US8] E2E: the dialog **names the project** it is editing; switching project shows the new project's paths, not the old one's.
- [x] T093 [P] [US8] E2E: with **no project active**, the options icon is **disabled** and its hover title says why; the dialog is unreachable (FR-041). (The spec originally said "absent **or** disabled" — a disjunction no test could meaningfully fail. Disabled is now the settled behaviour.)
- [x] T094 [P] [US8] E2E: deleting the project while its dialog is open does not leave the dialog editing a stale project or writing to a dead one (FR-046). Also assert the hidden list **goes with the project** when it is deleted (spec, Edge Cases) — almost certainly true today via the cascade, but asserted nowhere.
- [x] T095 [P] [US8] E2E: **the trap** — a path that is both hidden and matched by a global exclusion glob is **marked** in the dialog, because removing it will *not* bring it back (the glob filters one stage earlier). A remove button that visibly does nothing would be worse than the bug being fixed (FR-047a). Also assert the dialog **states that the global exclusions apply** (FR-047) — the hidden list must never be mistaken for the whole story, and that sentence is a requirement, not decoration.
- [x] T096 [P] [US8] **Unit** (not E2E — the completeness audit is a vitest test in `@throng/core`, and asserting it from Playwright would be either impossible or a tautology): the existing configuration-completeness audit passes **unchanged**, and no project-scoped key has entered the user-settings registry (FR-045/SC-008).
- [x] T096a [P] [US8] E2E: **a hidden path whose file has been deleted on disk still lists, and still removes.** The list names paths, not files, and a naive render that stats each one would throw on exactly this case — which is the one a user hits after hiding a build artefact and then cleaning. (Spec, Edge Cases.)
- [x] T097 [US8] Add the options icon to the File & Folders pane header in `packages/ui/src/renderer/panes/file-explorer-pane.tsx`, drawn from the new `settings` icon token with a hover title naming the action. **Disabled when no project is active**, with a hover title saying why (FR-041) — the dialog must never be reachable without a project, which is what T093 asserts. Follow the Projects pane header pattern — but **not** its hard-coded `＋` glyph (T058a fixes that).
- [x] T098 [US8] Build the dialog in `packages/ui/src/renderer/project-settings/`, themed from theme tokens, using the **confirmation and notification models** from US6 — introducing no further notice idiom (FR-044). It MUST **name the project it is editing** (FR-042), so the user is never in doubt which project's settings are on screen — the behaviour T092 asserts.
- [x] T099 [US8] Implement un-hide as a list filter through the existing `setHidden`, and state in the dialog that the global exclusions also apply, so the hidden list is never mistaken for the whole story (FR-047).
- [x] T099a [US8] Implement the **glob-overlap marking** that T095 asserts (FR-047a): evaluate each hidden path against the effective `explorer.excludeGlobs` set and render the marked state for any path that is *also* glob-excluded — because removing such a path will **not** bring it back (the glob filters one stage earlier, at fetch). Without this task, T095 tests behaviour that nothing builds.
- [x] T099b [US8] **Every action control introduced by this feature is a themed icon with a hover title** (FR-043a): the per-row **remove** control on the hidden-paths list, and the **clear** control on the icon-colour row (T076). The `destroy` and `dismiss` tokens already ship. The constitution's only exception is a **dialog decision button** — a per-row remove affordance is not one, and shipping either as a text button would fail the code-review gate.
- [x] T099c [P] [US8] E2E: those controls render as icons from the active pack and carry hover titles naming their action (Principle V — a user-facing control may not be marked done on unit evidence alone).
- [x] T100 [US8] Key the dialog on the active project id and close it when that becomes `null`, mirroring the explorer's existing remount-on-switch guard.

---

## Phase 11: User Story 9 — A file can be dragged in from the operating system (P3)

**Goal**: drop a file, it opens. Drop the wrong file, it is visibly refused. Read scope equals write scope.

**Independent test**: drag a file onto an editor panel — it opens. Onto an untyped panel — it becomes an
editor. One that violates ownership — visibly rejected, never a silent no-op.

> **The seam is the design** (FR-066a). `File → absPath` is a one-line adapter over `webUtils.getPathForFile`
> (Electron 43 removed `File.path`); everything downstream is a **pure, path-taking function**. A file
> synthesised in the renderer is **not** an OS file and the extractor returns empty for it — so a
> fabricated drop event **cannot** exercise the real extraction, and no test here will pretend it does.

- [x] T101 [P] [US9] Unit test the drop resolution in `packages/core/tests/unit/drop-confinement.test.ts`: project-owned accepts in-tree and refuses out-of-tree; sub-workspace-owned accepts outside-all-projects and refuses inside-a-project; a folder is refused; the rule is applied to the **resolved** path.
- [x] T102 [P] [US9] Integration test in `packages/ui/tests/integration/drop-resolve.test.ts` against a real filesystem: symlinks are resolved **before** the ownership rule (both directions — a link inside a project pointing out, and a link outside pointing in); folders, oversized files and missing files return their distinct reasons.
- [x] T103 [P] [US9] Integration test that the **load** path now refuses what the **save** path refuses, with the new `out-of-tree` reason — and that the reason is **distinguishable** from a missing file. Today a rejected load is reported as a missing file and is **suppressed** when missing-file warnings are off, so the silent no-op FR-061 prohibits **already exists** (research C13).
- [x] T103a [P] [US9] Cover the **restore-on-mount** open route (FR-059, SC-012): a sub-workspace panel whose persisted `filePath` points *inside* a project must be refused on restore, with the same visible reason. **This is the route a user hits with no gesture at all** — the panel simply reopens — and it is the one most likely to be forgotten, because there is no interaction to write a test around. Read scope must equal write scope on **every** route, not just the ones the user can see themselves taking.
- [x] T104 [P] [US9] E2E in `packages/ui/tests/e2e/os-drop.e2e.ts`: dropping a file onto an editor panel in its own project opens it (driven through the path-taking seam).
- [x] T105 [P] [US9] E2E: dropping onto an **untyped** panel makes it an editor showing the file, with no panel-type form.
- [x] T106 [P] [US9] E2E: dropping a file from **outside** the project onto a project-owned panel is **visibly rejected** — never a silent no-op.
- [x] T107 [P] [US9] E2E: a drop in a **sub-workspace window** opens the file — the only file-open affordance that window has, since it mounts no explorer.
- [x] T108 [P] [US9] E2E: dropping a file that lives **inside a project** onto a sub-workspace panel is **rejected**, and the notice says it belongs to a project. **This file would have opened before this feature and then refused to save** — the trap being closed (SC-012).
- [x] T109 [P] [US9] E2E: a file **already open** in another panel **focuses** that panel rather than opening a second copy (one buffer per file).
- [x] T110 [P] [US9] E2E: a **folder** drop is rejected; a **multi-file** drop opens each file.
- [x] T110a [P] [US9] E2E: a file **exceeding the maximum openable size** is **visibly refused** through the notification model. Every other rejection (out-of-tree, folder, symlink) has an end-to-end test; this one was covered only at the integration layer, and FR-061 prohibits a silent no-op for **any** rejection.
- [x] T111 [P] [US9] E2E: **the one that would have destroyed the app** — dispatch a file drop somewhere that is *not* a panel (title bar, sidebar, status bar) and assert the renderer **does not navigate away**. Nothing prevents this today (FR-061a): a stray drop currently replaces the running workspace with the dropped file.
- [x] T112 [P] [US9] E2E: an OS file drag shows a **copy** cursor, not a **move** one — the explorer's window-level listener rewrites `dropEffect` on *every* drag with no check for whether it is an OS file drag, and its default is `move` (FR-063).
- [x] T112a [P] [US9] E2E: **the symlink escape is refused through the running application** (SC-011). Create a link inside the project resolving to a file outside it, drop it, and assert it is rejected. Unit (T101) and integration (T102) cover the rule; SC-011 is a **user-visible** refusal, and FR-066 requires E2E for every user-facing change. FR-066a's "cannot be tested end-to-end" exemption covers the **path extraction** alone — it does **not** extend to the confinement rule, and must not be stretched to cover it.
- [x] T113 [US9] Expose `getPathForFile` via `packages/ui/src/preload/preload.cts` (and mirror it in `global.d.ts`). This is the one line E2E cannot reach, and that is stated rather than hidden.
- [x] T114 [US9] Add the `throng:editor:resolveDrop` channel in `packages/ui/src/main/editor-ipc.ts`: realpath, folder check, size check, and `resolveSaveConfinement` — **the decision is made in main, not trusted from the renderer**.
- [x] T115 [US9] Bring the load path into line in `packages/ui/src/main/editor-coordinator.ts`: resolve symlinks **first**, apply the **full** confinement rule (including the outside-all-projects branch, absent today), and stop skipping the check when the owner root is unknown.
- [x] T116 [US9] Add the `out-of-tree` reason to `LoadResult` in `packages/ui/src/main/editor-service.ts` and `global.d.ts`, and handle it in `use-editor.ts` so it is **never** classified as a missing file and **never** suppressed.
- [x] T117 [US9] Build the drop target in `packages/ui/src/renderer/editor/drop-target.tsx`: `dragover`/`drop` on the panel, `File → path` via the adapter, then the pure handler. Reuse the existing open/focus routing rather than reimplementing it. **Iterate `dataTransfer.files`** — a drop carries *n* files (FR-065): resolve and open each in turn; a folder among them is rejected individually rather than failing the whole drop. `resolveDrop` takes one path, so the multi-file loop lives here.
- [x] T117a [US9] Mount the drop target on the **untyped panel** surface (`packages/ui/src/renderer/panel-type/`) and convert the panel to an editor on a successful resolve — `setPanelType(id, 'editor', { filePath })` plus the type notification — reusing T117's handler rather than reimplementing it (FR-056).

  > **T105 asserts this and nothing built it.** T117 mounts a drop target on the *editor* panel; an untyped panel does not render one, so the drop would land on nothing. This is the third instance of the same defect class the earlier passes caught (T099a, T058b): **a test asserting behaviour nobody wrote.** Note the panel-type form has no file input at all — the conversion route is `setPanelType`, exactly as the explorer's "open in dedicated editor" already does it.

- [x] T118 [US9] Gate the explorer's window-level `dragover` listener (`packages/ui/src/renderer/explorer/file-tree.tsx:117-145`) on `dataTransfer.types.includes('Files')`, so it stops rewriting the cursor for OS file drags.
- [x] T119 [US9] Add the **renderer-side** window-level `dragover`/`drop` guard that prevents the browser engine navigating to a dropped file (FR-061a) — `window.addEventListener('drop', e => e.preventDefault())` and the matching `dragover`, mounted in `packages/ui/src/renderer/composition-root.tsx` so it covers the main **and** sub-workspace windows.

  > **Pick the mechanism deliberately.** A renderer `preventDefault` and a main-process `will-navigate` handler are different guards with different failure modes. The renderer one is what **T111 actually tests** (it dispatches a drop and asserts the page did not navigate), and it is the one that stops the default *before* it becomes a navigation. Name it here so nobody builds the other.
- [x] T120 [US9] Show the rejection affordance through the **notification model** from US6 (FR-061) — a drop-cursor/overlay state on the panel, reinforced by the notice.

---

## Phase 12: Polish & cross-cutting

**Depends on every story** (US1–US9), not just US7 — the sweep and the docs describe the whole feature.

- [x] T120a **The SC-004 theme sweep** — E2E: iterate **every** bundled theme (all 14 plus `throng`), activate each, and assert no surface is left visually stale: every menu, scrollbar and icon repaints. It lives **here**, not in US1, because it asserts scrollbars (US3) and the migrated menus (US2). A single sampled theme does not prove a criterion that says "switching between **all** of them".
- [x] T121 Bring `README.md` and `ROADMAP.md` current in the same change (FR-067, constitution's documentation-currency rule): the two notice models, the themed picker, the project-settings dialog, OS file drop, sliders, and the expanded token set. The README describes the **current shipped state**, not a changelog. Also **review `CONTRIBUTING.md`** — the rule names it "at minimum" alongside the other two; if this feature changes nothing about the toolchain or the testing bar, say so explicitly rather than leaving it silently unconsidered.
- [x] T122 Reconcile feature 015's relaxed "exactly one confirmation model" criterion — this feature discharges that deferral (FR-067a).
- [x] T123 Reconcile feature 006's spec to record that read scope and write scope now agree, and that its load path was repaired (FR-067a).
- [x] T124 Run the **full** suite once, unfiltered, capturing complete output: lint, type-check, unit, integration, contract, E2E. Report real numbers and name any flaky test honestly rather than rounding up to green.
- [x] T125 **Clean up after ourselves** (constitution, Principle V — test-artifact and temp-file cleanup, NON-NEGOTIABLE): delete the scratch captures from T001, T002a and T124, and confirm the working tree carries no generated artefact. *"A green test bar MUST NOT leave orphaned generated files behind."*
- [x] T126 Assert **no `describe.skip` survives** in the guards this feature adds. T002a deliberately quarantines the SC-002 guard from Phase 2 until T058d un-skips it — and if US2 ever slipped or were descoped, a **skipped test would ship** and SC-002 would be silently unenforced. That is the exact failure the guard exists to prevent, so it gets a guard of its own.

---

## Dependencies

```text
Setup (T001)
   └─ Foundational (T002, T003, T002a, T002b, T002c)   ← THE SCOUTS. Do not skip them.
         │   T002/T003  the --danger repair + the guard that found its real count (13, not 4)
         │   T002a      the colour-literal scout
         │              └── feeds T009 (the roster) and T014 (the constant) — which is what
         │                  makes "re-derive the constant once" actually TRUE
         │   T002b      the token call-site scout, resolving the ALIAS CHAIN
         │              └── feeds T007, T013a, T015–T020a. Without it you will miss the 14
         │                  sites that read the token as `--bg-panel`, a third alias name
         │                  that no hand-written list in this feature ever knew about
         │   T002c      the menu scout
         │              └── feeds T045/T045c. There is a THIRD bespoke menu (the font list)
         └─ US1  Token split (T004–T024)          ★ blocks everything
               │                                    ALL 15 tokens land here, incl. the `settings` icon
               ├─ US6  Notice models (T025–T044)  ← sequenced 2nd; US8 + US9 consume it
               │     ├─ US8  Project settings (T091–T100)
               │     └─ US9  OS drop (T101–T120)
               ├─ US2  Menus (T045–T058d)
               ├─ US3  Scrollbars (T059–T062)
               ├─ US4  Colour picker (T063–T072)
               │     └─ US5  Icon colour (T073–T077a)
               └─ US7  Numeric controls (T078–T090)

Polish (T120a–T126)  ← depends on ALL NINE stories, not just US7.
                        T120a  the all-theme sweep — asserts scrollbars (US3) and the
                               migrated menus (US2), so it cannot run before them
                        T125   delete the scratch artefacts (Principle V, NON-NEGOTIABLE)
                        T126   assert no `describe.skip` survives in the new guards
```

> **US8 does NOT depend on US2.** An earlier draft of this graph said it did, on the grounds that US8's
> options icon needs the `settings` icon token — but **every token lands in US1** (T009), including the
> `throng-svg` pack shapes (T013). US8's real dependencies are US1 and US6. The false edge serialised two
> tracks that can run in parallel.

## Parallel opportunities

- **Within US1**: T004–T007 (the tests) are independent files. T016–T020 (re-pointing CSS call sites) touch different rules and can run together once the tokens exist.
- **Within US6**: T027–T031 (the E2E scenarios) are independent. T038, T039, T041, T042 touch different components.
- **US2, US3, US4 and US7 are independent of each other** once US1 lands — four parallel tracks.
- **Within US9**: T104–T112 are independent E2E scenarios.

## MVP scope

**US1 alone is a shippable increment** — it is the data-model change every other story builds on, and it
is independently valuable: a theme author can colour each surface without breaking another. US1 + US6 is
the natural first PR if the feature were to be split.

## Format validation

**154 tasks**, each with a checkbox, an ID, a story label where the phase requires one, and an exact file
path. (Counted by `grep -c`, not by hand — see T003 for why that distinction is the whole feature.)

> **T021 and T022** (the drag-ghost window and the pre-mount fallback) trace to
> `contracts/theme-tokens.md` — "Consumers that are easy to miss" — rather than to a numbered
> requirement. They are real work, not scope creep: the drag ghost is a **separate `BrowserWindow`** that
> would silently drift from the theme.

**Added during the analyze loop** — six passes, each closing a real gap rather than a cosmetic one:

| Task | Why it exists |
|---|---|
| T013a | FR-002's `surfaceActive` audit had **no task recording its result**. An unrecorded audit is indistinguishable from one that never ran. |
| T120a | SC-004 says "switching between **all** bundled themes" — every E2E sampled **one**. First added to US1 as T024a; a later pass caught that it asserts scrollbars (US3) and migrated menus (US2), so it could not have passed at its own checkpoint, and moved it to Phase 12. |
| T058c | **SC-002's own verification method was one-third built.** The inline-artwork guard was scoped to "menu and pane components" — which would not have discovered `window-controls.tsx` in `title-bar/`, one of the very surfaces SC-002 was failing on. And nothing guarded the "hard-coded literal" clause at all. A guard narrower than the criterion it verifies leaves SC-002 true at merge and **unenforced thereafter**. |
| T058a | SC-002 says **zero** icons draw from an inline vector, while the plan deferred four window controls and a `＋` glyph. The criterion would have been **false at merge** — the exact failure this feature's own Complexity Tracking calls out for FR-051. |
| T058b | FR-016/FR-017 (flip-clamp, single-menu-open) had **tests but no implementation task** — they rest on the cog menu inheriting both "for free" from the shared menu. True, per Phase 0 — but an assumption asserted by a test and built by nobody must be confirmed, not trusted. |
| T099a | FR-047a's glob-overlap marking had **a test (T095) and nothing building it**. |
| T112a | SC-011 (the symlink escape) was covered by unit and integration only. It is a **user-visible refusal**, and FR-066a's E2E exemption covers the path *extraction* alone — it must not be stretched to cover the confinement rule. |
| T058d | The literal guard had **no repair task**. A guard with nothing scheduled to make it pass is a guard that gets deleted. |
| T076/T077a | **The one CRITICAL.** `iconColour` as specified was **uneditable** — the descriptor registry is derived from the built-in theme's leaves, so an optional unset token gets no descriptor, violating a NON-NEGOTIABLE constitutional rule; and giving it a default to fix that would break FR-029. Resolved by following the **icon-pack precedent** (a hand-authored descriptor), plus a test the derived audit *structurally cannot* provide. |
| T031a | FR-049 (decision buttons keep **text labels**) — the constitution's explicit exception to the icon rule, and the reason there are two models — had **no test**. |
| T096a | The "hidden path whose file was deleted on disk" edge case — the one a naive list render actually throws on — had no coverage. |
| T002a/T058d | The colour-literal guard ran **after** the token roster froze, so anything it found needing a new token could not be added without invalidating the re-derived constant. Moved to Phase 2 as a scout. It also turned out that the TypeScript `??` colour fallbacks are **live, not dead** — a partial user theme leaves the token `undefined` and the literal paints. That is FR-008's bug in TypeScript. |
| T099b/T099c, T047 | **Two fresh constitutional violations, in the feature built to repair them.** The hidden-path *remove* control and the icon-colour *clear* control were about to ship as text buttons; and the pane chevrons and submenu arrow were changing icons on **unit evidence alone**, which Principle V forbids. |
| T068a, T083a, T096, T079, T103a | Half-tested guarantees: FR-023's second promise (debounced writes compound), FR-039's *other* editor, an audit filed at the wrong test layer, unbounded numerics never enumerated, and the restore-on-mount open route — the one a user hits with no gesture at all. |

**The pattern in that table is this feature's own thesis, turned on itself.** Again and again the defect
was *a claim about the codebase made by hand, and wrong*: the `--danger` count (4 → 13, across a third
file nobody named), the guard scoped narrower than the criterion it verified, the deferral that would
have made a success criterion false at merge, the `??` fallbacks assumed dead that were live.

**Six analyze passes were needed to stop making it.** That is the argument for the guards in one line:
the prose was wrong every single time, and the prose was written by people who had just read the code.

---

## Phase 13: Convergence

Appended by `/speckit-converge` after the adversarial review. Each item traces to a requirement the
code does not yet fully satisfy — found by reading the code against the spec, not against the tasks.

- [x] T127 Give the font typeahead **flip and clamp** (`packages/ui/src/renderer/preferences/pickers.tsx`, `preferences.css` `.ctl__font-list`) and write the **discovering** floating-surface guard FR-013 demands — one that finds floating surfaces rather than checking two known class names, since a guard that enumerates two of three implementations reports green while the requirement is false. Per FR-013 (partial).
- [ ] T128 Make `scrollbarThumbHover` paint, or record on the spec's own terms that it cannot: the global rule uses the standard `scrollbar-color` property, which Chromium gives no hover state, so the token currently paints nowhere but the terminal and US3/AC1 ("track, thumb **and thumb-hover** come from theme tokens") is false for every other surface. Either scope `::-webkit-scrollbar` rules to surfaces where the layout shift is harmless, or amend the criterion. Per US3/AC1, FR-010 (partial).
- [x] T129 Extend the SC-002 guard to see the artwork it currently cannot: it walks `renderer/**/*.tsx` for `<svg>` and `renderer/**/*.css` for colour literals, so a colour painted from **TypeScript** or from the **main process** (the drag-ghost window) is invisible to a guard that claims zero surfaces. Per SC-002 (partial).
- [ ] T130 Put the **renderer** in the type-check project. `npm run typecheck` (`tsc -b`) does not include `tsconfig.renderer.json`, so SC-013 ("type-check passes with zero errors") says nothing about renderer code — which is how a duplicate import shipped. Five pre-existing renderer errors (react-arborist ref/OpenMap, FindPanelKind, terminal `meta`) must be fixed for the gate to go green; they are NOT caused by 018 and may warrant their own issue. Per SC-013 (partial).
- [x] T131 [P] Fix the colour picker's hue slider for achromatic colours: hue is re-derived from the round-tripped RGB, so at `#ffffff`/`#000000` every drag commits an achromatic hex, `rgbToHsv` returns `h: 0`, and the slider snaps back to zero — the control cannot be driven out of black or white. Per FR-026 (partial).
- [x] T132 [P] Restore the cog menu's **toggle**: the shared menu's window `pointerdown` listener closes it and the button's `onClick` immediately reopens it, so the cog can no longer close its own menu — a small accessibility/usability regression from the migration the bespoke menu did not have. Per FR-013 (partial).
