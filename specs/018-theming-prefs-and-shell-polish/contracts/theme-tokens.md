# Contract: Theme tokens

**Consumers**: theme authors (hand-written JSON in the user profile), the Themes editor, every renderer
surface, the drag-ghost window (a separate `BrowserWindow`).

## The public surface

```ts
interface ThemeColours {
  // ── kept, role narrowed ────────────────────────────────────────────────
  surface: string;               // pane & panel body ONLY (was: ~30 sites, 8 roles)
  surfaceActive: string;         // selected/active row, active panel header, active tab chip

  // ── new: roles carved out of `surface` ─────────────────────────────────
  menuSurface: string;           // menus, drop-downs, context menus, typeahead lists
  inputSurface: string;          // text inputs, selects, search boxes, hex fields
  hoverSurface: string;          // row hover, icon-button hover, chrome hover
  dialogSurface: string;         // modal cards, dialog bodies, the find bar

  // ── new: the menu-item hover, and the foreground that sits on it ───────
  menuItemHoverSurface: string;  // the hovered row INSIDE a menu (parent: `accent`)
  accentText: string;            // the foreground ON `accent` — hard-coded #06101f in 2 places today

  // ── new: scrollbars ────────────────────────────────────────────────────
  scrollbarTrack: string;
  scrollbarThumb: string;
  scrollbarThumbHover: string;

  // ── new: OPTIONAL. unset ⇒ icons inherit their host's colour ───────────
  iconColour?: string;

  // …33 existing tokens unchanged
}

interface ThemeIcons {
  settings: IconValue;           // NEW — the gear. Used by the cog menu AND the options icon.

  // NEW — the window controls, which draw hard-coded inline vectors today.
  windowMinimise: IconValue;
  windowMaximise: IconValue;
  windowRestore: IconValue;
  windowClose: IconValue;
  // …41 existing tokens unchanged
}
```

## The roster — this table is the authority

**10 new colour tokens, 5 new icon tokens.** The prose in `spec.md` and `plan.md` defers to this list.

| # | Token | Kind |
|---|---|---|
| 1 | `menuSurface` | colour |
| 2 | `inputSurface` | colour |
| 3 | `hoverSurface` | colour |
| 4 | `dialogSurface` | colour |
| 5 | `menuItemHoverSurface` | colour |
| 6 | `accentText` | colour — the foreground on `accent` |
| 7 | `scrollbarTrack` | colour |
| 8 | `scrollbarThumb` | colour |
| 9 | `scrollbarThumbHover` | colour |
| 10 | `iconColour` | colour — **optional** |
| 11 | `settings` | icon |
| 12–15 | `windowMinimise`, `windowMaximise`, `windowRestore`, `windowClose` | icon |

`surface` and `surfaceActive` are **kept**, with narrowed roles.

**Icon tokens do not participate in the colour-distinctness metric**, so the five new icon tokens cost
nothing against FR-006. Only the **9 non-optional colour tokens** move the constant (10 colour, less the
optional `iconColour`).

## The `surfaceActive` audit (FR-002) — **to be produced by the scout, not by hand**

FR-002 requires `surfaceActive` be audited on the same role boundaries and split *wherever it too does
more than one job*, and that **the result be recorded**.

> ### ⚠ The hand-written audit that used to sit here was WRONG, and it is instructive
>
> It recorded **three** remaining sites, all expressing one "selected/active" role, and concluded that
> FR-002 was discharged by a single new token.
>
> The tree has **ten**. Four of them are **hover states** — the explorer toolbar button, the pane
> collapse control, the search clear button and the generic icon button, all `:hover`. So `surfaceActive`
> **is** doing the row-hover job that FR-001 orders carved out, which is precisely the question FR-002
> asks and precisely the answer the hand count missed.
>
> It also filed the **active tab chip** under `surfaceActive`. The chip reads the *pane* token (through
> `--bg-panel`, a **third alias name** that appears nowhere else in this feature's documents). **SC-001
> names the active tab chip by hand** as a surface that must stop following the pane background — and no
> re-point task owned it.
>
> **An audit done by hand is not an audit.** That is this feature's entire thesis, and the document
> recording the audit is where it was violated. The record is only worth having if the count is real.

### The audit, as the scout actually found it (2026-07-13)

The scout resolved the alias chain and walked the tree. **31 reads of the pane token**, under three
names — and `--bg-panel` alone accounted for twelve of them, including the shared context menu and the
active tab chip. **12 reads of `surfaceActive`.** Every site was assigned a role from its own CSS rule:

| Role | Token | Sites |
|---|---|---|
| Pane / panel body | `surface` *(kept)* | `.pane--explorer`, `.panel-box` |
| Menus & floating lists | `menuSurface` | `.context-menu`, `.cog-menu__list`, `.kb-ctx-menu`, `.ctl__font-list` |
| Fields | `inputSurface` | `.project-form__field`, `.project-form__colour`, `.subworkspace-item__rename`, `.settings-search__input`, panel-type form controls |
| Hover | `hoverSurface` | `.tree-row:hover`, `.keybinding-row:hover`, title-bar chrome hovers, **and the four icon-button hovers that were on `surfaceActive`** |
| Dialogues & floating cards | `dialogSurface` | `.modal`, `.app-closing__card`, `.capture-modal`, `.find-bar`, `.app-close-table th`, the terminal's starting overlay, the three notice strips |
| Menu highlight | `menuItemHoverSurface` | `.context-menu__item:hover`, `.cog-menu__item:hover`, `.kb-ctx-menu__item:hover`, `.ctl__font-item:hover` |
| Selected / active | `surfaceActive` *(kept)* | `.tree-row--selected`, `.project-item--active`, **`.tab-chip--active`**, `.panel-box--active .panel-box__header`, `.ctl__pill` |
| Buttons | `buttonBg` / `buttonHoverBg` *(existing)* | panel-type actions, `.panel-box__actions button:hover`, `.folder-picker__browse` |
| Text on accent | `accentText` | **four** literal `#06101f` sites: the submit button, the menu hover, and two confirm buttons |

**FR-002 is discharged.** `surfaceActive` now paints **only** selected/active surfaces — the four hover
states it was quietly also doing have moved to `hoverSurface`, which is precisely the second job FR-002
asked the audit to look for. The hand-written audit that used to sit here said there was no second job.

Both findings — the `--bg-panel` alias and the four hover states — were found by **walking the tree**.
Neither appears in any hand-written list in this feature, including the ones written by people who had
just read the code. That is the argument for the guard, and `surface-token-roles.test.ts` now enforces
all of it.

> Knock-on to preserve: `surfaceActive` also seeds `buttonBg` and both selection colours in every bundled
> theme's derived palette. Leaving it intact for the selected/active role keeps those derivations correct
> rather than silently re-pointing them at a narrower token.

## Resolution (FR-008) — the load-bearing rule

```ts
/** Resolve one colour token, honouring the split's parent fallback. */
function resolveSplitColour(theme: Theme, token: keyof ThemeColours): string | undefined;
```

```text
theme.colours[token]  ??  theme.colours[PARENT[token]]  ??  THRONG_THEME.colours[token]
```

| Token | Parent |
|---|---|
| `menuSurface`, `inputSurface`, `hoverSurface`, `dialogSurface` | `surface` |
| `menuItemHoverSurface` | **`accent`** — see below |
| `accentText` | *(none)* |
| everything else | *(none — falls straight to the built-in default)* |

### Why `menuItemHoverSurface`'s parent is `accent`, not `surfaceActive`

**The shared menu's item hover does not use `surfaceActive` today. It uses `var(--accent)` with a
hard-coded near-black foreground** (`theme.css:990-992`: `background: var(--accent); color: #06101f`).
Only the *bespoke* menus (cog, Key Bindings, font list) use `surfaceActive` for their hover.

So there are **two menu-hover idioms** in the app, and unifying the menus necessarily picks one. It picks
the **shared menu's**, because that is the menu that survives, it is the one users see most, and an
accent-highlighted selection is the standard menu affordance.

Consequences, stated plainly:

- **US1 changes nothing visually.** `menuItemHoverSurface` falls back to `accent`, which is exactly what
  the shared menu already renders. The three bespoke sites keep reading `surfaceActive` until US2.
- **US2 changes the cog and Key Bindings menus** — their hover moves from `surfaceActive` to the accent
  highlight. **This is the point of the story**, not a regression: "one menu implementation" means they
  stop looking like two.
- The claim "all bundled themes are visually identical after the split" belongs to **US1 (the token
  split)** and remains true. US2 (the menu unification) deliberately makes three menus look like the one
  they are becoming.

### `accentText` — a foreground role that was never a token

`#06101f` is hard-coded as *"the text colour that sits on top of the accent colour"* in **at least two**
places today (`theme.css:993` menu-item hover; `theme.css:1219` the modal confirm button). It is a real,
recurring role with no token, so it is added as one: **`accentText`**.

It also gains a **contrast pairing** (`accentText` on `accent`), since it is a foreground on a background
and the guard exists to catch exactly that.

**This MUST be resolved before the CSS variables are emitted, and MUST NOT be expressed as a CSS
`var(…, fallback)`.**

The variable emitter merges every theme over the built-in defaults *before* emitting, so every
`--throng-colour-*` property is **always defined** and a CSS fallback can never fire at runtime. A
CSS-level fallback would therefore resolve a pre-split theme's `menuSurface` to **throng's** default
rather than to **that theme's** `surface` — visibly changing a theme the user already had, which is
exactly what FR-008 forbids.

There is a dead precedent of this mistake already in the tree (`theme.css:24`,
`--btn-bg: var(--throng-colour-buttonBg, var(--bg-panel))`), inert since feature 007. Do not add another.

### `iconColour` is different

It is the **only optional** colour token, and its absence is **meaningful**. It MUST NOT be given a
default by the resolution chain. When unset, no `--throng-colour-iconColour` property is emitted at all,
so `.icon { color: inherit }` continues to bind the artwork to its host control — which is what makes
FR-029 true (*no existing theme changes appearance*).

## Obligations on every new token

1. **A value in every bundled theme** — the 14 shipped themes **plus** the built-in `throng` theme.
   Bundled themes derive from a compact palette, so each new token is derived from its parent there:
   `menuSurface: p.menuSurface ?? p.surface`. The bundled themes are therefore **visually identical**
   after the split; the point is that an author *can now* differentiate them.
   **Exception**: `iconColour` is optional and MUST be excluded from the all-themes completeness sweep.

2. **Hand-written copy** — a label and a description. The copy test bans these abbreviations, on a word
   boundary, case-insensitively, **in the copy text** (the key itself is not checked):

   > `bg fg bkg fore min max cfg config id num btn sel`

   and rejects any description that is mechanically derivable from the key. So `iconColour` is a legal
   *key*, but its description may not read "The icon colour bg token."

3. **The distinctness constant re-derived.** The guard asserts
   `CLOSEST_LEGITIMATE_PAIR_DELTA` *equals* the measured closest-pair delta (2 dp). The metric is a
   **mean** over shared colour tokens, so **adding tokens moves it even when every new value duplicates
   an existing one** — the denominator changes. It will break on a change that is entirely correct.
   Re-derive it, and keep `DISTINCTNESS_THRESHOLD` just below. **Do not relax, weaken or disable it.**

4. **The contrast guard still passes.** 8 enumerated pairings gate 3 themes. `buttonText` on
   `surfaceActive` is the only pairing touching a split token. Any new foreground/background pairing the
   split introduces is added to the enumeration.

5. **It must be EDITABLE** — the constitution's configuration-editor-completeness rule is
   non-negotiable: *every* theme token must be exposed in the visual editor.

   **For a required token this is automatic**: the descriptor registry is *derived* from the leaves of
   the built-in theme, so adding a token to `THRONG_THEME` gives it a descriptor for free.

   **For `iconColour` it is not**, and this is a trap that fails the build in both directions:

   - Leave it **unset** in `THRONG_THEME` → it is not a leaf → **no derived descriptor** → it is
     **uneditable**, and any hand-added descriptor lands in the audit's `unknown` list and **fails the
     completeness test**.
   - Give it a **value** in `THRONG_THEME` → it becomes a leaf and gets a descriptor → but now it is
     *set* by default, every theme's icons adopt it, and **FR-029 breaks** ("no existing theme changes
     appearance").

   **Resolution — follow the precedent that already exists.** The **icon pack** (`theme.iconPack`) is an
   optional theme field, absent from the derived registry, surfaced in the Icons section by a
   **hand-authored descriptor**. `iconColour` is surfaced the same way, sitting beside it. It is
   therefore editable without entering the derived registry, so the audit is untouched and FR-029 holds.

   A test must assert that **every optional token is reachable in the editor** — because the derived
   registry's completeness audit, by construction, cannot.

## Consumers that are easy to miss

- **The drag-ghost window** (`ghost-window.ts`, fed from `main.ts`) is a **separate `BrowserWindow`**
  that receives resolved colours over IPC. It reads `surface` and `surfaceActive` today and will drift
  from the theme unless updated in the same pass.
- **Derived palette values**: `buttonBg` falls back to `surfaceActive`, and both selection colours fall
  back to it too. Splitting `surfaceActive` therefore changes derived values across every bundled theme —
  which is itself one of the reasons the distinctness constant moves.
- **The static pre-mount fallback** (`tokens.css`) carries 9 colours for the instant before the theme
  provider mounts. New tokens used by first-paint surfaces belong here too.
