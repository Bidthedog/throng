# Research: Theme contrast gate

Measured on master `588bffc6` with `contrastFailures()` over `ALL_DEFAULT_THEMES`.

## R1 — Does any theme need recolouring for the wider gate?

- **Decision**: No. Only the new accent pairing needs retuning.
- **Rationale**: Every theme outside Matrix, VI-VIM and Gothic has zero failing pairings today. Gothic fails one
  (`syntaxInvalid` on the selection, 4.39), VI-VIM nine, Matrix two — all by-design themes.
- **Accent text on accent today**: throng 7.53, Light 4.78, Snake 5.53, Windows Terminal 6.14, Bash 11.75, SUBNET
  12.58, **VSCode 3.70**, **English Garden 3.54**, Cyberpunk 14.11, Claude 5.76, **Debian 3.36**, Ubuntu 5.11; by-design
  Gothic 2.06, VI-VIM 4.15, Matrix 15.38.
- **Alternatives**: changing `accent` instead — rejected by #716 and FR-005 (theme identity).

## R2 — How do retuned values reach existing installs?

- **Decision**: Bump `SHIPPED_DEFAULTS_VERSION` 38 → 39 with a frozen `V38_MOVED_COLOURS` record of every token R3a
  moves, with the value 38 wrote (VSCode, English Garden, Debian: the four text-on-accent tokens; SUBNET: the three
  text-on-danger tokens), wired into `planThemeValueUpgrade` exactly as #105's
  `V37_MOVED_COLOURS`. A file still holding the old value moves; a user-edited value stays.
- **Rationale**: Constitution X, *Every theme setting belongs to its theme*; the guarded rewrite is the established
  mechanism (versions 6, 19, 37). Editing 38 in place is ruled out for #105's reason: installs already hold a 38 marker.
- **Fixture**: `theme-leaves-by-version.json` records ADDED leaves; a moved value adds none. Check the
  `theme-leaves-version` test's expectation for a value-only bump (#105 is the precedent) and follow it.

## R3 — The new accentText values

- **Decision**: Pick each by walking `accentText` toward white (or black) from the shipped value until 4.5:1 clears with
  margin, keeping the hue family the theme uses for text on fills. Concretely chosen at implementation and recorded in
  the commit; the gate test proves them.
- **Note**: VSCode's own UI uses white on `#007acc`; English Garden and Debian already pair light/dark text elsewhere.

## R3a — How a per-theme value reaches the derived tokens

- **Decision**: `makeTheme` derives `accentText`, `confirmButtonText`, `confirmButtonHoverText` and
  `cancelButtonHoverText` all from `p.bg`, and `dangerText`, `destroyButtonText`, `destroyButtonHoverText` from
  `'#ffffff'`. Add two optional palette fields, `onAccent` and `onDanger`, and derive each family from
  `p.onAccent ?? p.bg` and `p.onDanger ?? '#ffffff'`. Only VSCode, English Garden and Debian set `onAccent`; only SUBNET
  sets `onDanger` (`#001B40`, its own background, 6.15:1). Every other theme's tokens are byte-identical.
- **Measured button pairs today** (rest and hover alike): at 3:1, among gated themes only SUBNET's Destroy fails
  (2.77). At 4.5:1 Destroy would fail in eleven themes — out of scope (spec Clarifications).

## R4 — Where the gate list lives

- **Decision**: Delete `IN_SCOPE_THEMES`. The contrast gate iterates the themes it is given and skips names in
  `BY_DESIGN_LOW_CONTRAST_THEMES`; `knownContrastIssues` reports only by-design themes. One list, read by every gate
  (FR-003).
- **Alternatives**: keep `IN_SCOPE_THEMES` as the 12 names — rejected: a new bundled theme would be silently ungated,
  contrary to the spec's edge case.

## R4a — Round 2: no exemption at all

- **Decision**: Delete `BY_DESIGN_LOW_CONTRAST_THEMES` and `knownContrastIssues`; every gate covers every theme given.
  `makeTheme` runs #105's `readableSelection` for every theme.
- **Measured on the round-1 head**: Gothic failed accent text 2.06 (and the button pairs with it) and `syntaxInvalid` on
  its selection 4.39; VI-VIM accent text 4.15 and nine syntax colours on its selection (2.39–4.19); Matrix two syntax
  colours on its selection (2.87, 3.12).
- **Fix**: Gothic `onAccent: '#d8c8d0'` (its own text colour, 5.73:1); VI-VIM `onAccent: '#000000'` (5.12:1; its own text
  colour reads 2.56:1). The selection walk moves Gothic `#3a2540 → #37233d`, VI-VIM `#5f5f00 → #343412`, Matrix
  `#0f4f0f → #082b08`, each with its inactive selection; `V38_MOVED_COLOURS` records all of them.

## R4b — Round 4: Debian's accent

- **Measured**: on `#d70a53`, white 5.18, black 4.05 — no text colour does better; the pill against `bg` 3.36,
  `surface` 3.00. Darker reds raise the text ratio but sink the pill into the panel (`#a80030`: 2.24).
- **Decision** (maintainer's pick of five): accent `#ff5c8f`, `onAccent: '#000000'` — text 7.18, pill on `bg` 5.95,
  `sidebar` 6.30, `surface` 5.31. `danger` stays `#d70a53`. The derived accent tokens move with it; the two older
  search-colour pins (`shipped-defaults-v6-record`, `theme-occurrence-surfaces`) compare Debian's pre-078 values from
  `V38_MOVED_COLOURS`, so they still catch any other move.
- **Delivery**: hand-testing builds of this branch had written a 39 marker, with white text on the crimson, into the
  maintainer's development config, and the upgrade runs only when the marker differs. So 39 → 40, with
  `V39_MOVED_COLOURS` = Debian's four text-on-accent tokens at `#ffffff` (the one value an interim 39 wrote that 38 did
  not); both records apply together, reaching a 38 install and an interim-39 one alike.

## R5 — Measuring a user theme as the app paints it

- **Decision**: `completeTheme(name, parsed)` (`shipped-defaults.ts`) then `meetsWcagAa()`. It is the read path every
  window paints with (#643), so a partial user theme is judged by what the user sees.
- **Source of each theme's content in the Themes tab**: `listThemes()` gives names only. The tab reads each listed
  theme with the existing `config.readRaw({ kind: 'theme', name })`, parses, completes and measures it on every
  `refreshThemes()`. The ACTIVE theme is measured from `useActiveTheme()` instead, so an edit updates the mark and its
  option label as soon as it round-trips (FR-012).
- **Unreadable or invalid file**: not conforming (no label, no mark); errors stay where they are reported today.

## R6 — The picker presentation

- **Decision**: The picker is a native `<select>`; options cannot hold icons. A conforming option's text becomes
  `<name> — WCAG AA`; the `value` stays the bare name. Beside the select, a non-interactive icon (`wcagConformant`)
  with title "Meets WCAG AA contrast", shown only when the selected theme conforms. **Round 3**: the option label is
  dropped at the maintainer's request; options read the bare name, and only the active theme is measured.
- **Colour**: `colours.text` via `--throng-colour-text`. `success` was measured first and falls below 3:1 on Light (2.35) and English Garden (2.28); `text` on the app background is gated at 4.5:1 by FR-001, so the mark is legible wherever the gate holds. No new theme token, so no themes payload.
- **Icon art**: Lucide `shield-check` into `default-set/`, recorded in `SOURCES.json`, then `npm run generate:icons`.
- **Tests that pin option text**: any test or E2E selecting a theme by its option LABEL breaks; select by value. Search
  all layers for `theme-select` before changing the label (running-tests, *the tests covering the change*).

## R7 — Test layers

- Gate scope, the pairing, `meetsWcagAa`, the upgrade plan: **unit** (core).
- Option labels, the mark, its title, following an edit: **component** (`preferences-themes-tab` harness).
- No E2E: no assertion needs a real window.
