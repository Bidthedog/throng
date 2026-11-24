# Feature Specification: Theme contrast gate

**Feature Branch**: `feature/S078-I61-theme-contrast-gate`

**Created**: 2026-11-24

**Status**: Draft

**Input**: GitHub issues [#61](https://github.com/Bidthedog/throng/issues/61) (Theme accessibility: gate themes to
WCAG AA) and [#716](https://github.com/Bidthedog/throng/issues/716) (readable notification count on every theme), with
the maintainer's answers of 2026-11-24:

1. The conformance mark in the theme picker (#61, part 3) is built now, inside the v1.0.0 feature freeze: "Build it now
   (spec 078)".
2. The gate covers "every non-by-design theme" — every bundled theme except Matrix, VI-VIM and Gothic — rather than only
   the seven themes #61 names. **Superseded the same day** (Clarifications, round 2): all themes are gated.

Measured on master `588bffc6` before this spec was written: every bundled theme outside Matrix, VI-VIM and Gothic already
clears every pairing spec 009 enumerates. The redesign #61 describes for throng, Light, Snake and Claude is no longer
needed; widening the gate is a policy change, not a recolour. The new accent-text pairing (#716) is the only measurement
any of them fails: VSCode 3.70:1, English Garden 3.54:1, Debian 3.36:1, against 4.5:1.

## Clarifications

### Resolved at analysis, 2026-11-24

The analyze pass found that #716's pair has two more uses, and that 009 FR-016's button pairings were never measured. Each
is answered by the default below; the maintainer may overrule.

- Q: The Confirm button's text and the Cancel button's hover text are derived from the same value as the accent text,
  on the same accent fill, and fail the same way in VSCode, English Garden and Debian. In or out? → A: In. Every
  text-on-accent colour of a theme is one value, so the retune fixes all of them together (FR-005).
- Q: 009 FR-016 required the button text pairs (rest and hover) to be measured, at its UI-component threshold, 3:1. None
  was ever added. In or out? → A: In, at 009's 3:1 (FR-004a). Measured today, only SUBNET's Destroy button fails (white
  on `#FF6F32`, 2.77:1) among the gated themes; it takes SUBNET's own background as its text on the danger fill (6.15:1)
  (FR-005a). Raising button text to 4.5:1 would fail Destroy in eleven themes and is not part of this spec.

### Round 2, 2026-11-24

- Q: Should Matrix, VI-VIM and Gothic stay exempt as low-contrast by design (#61's policy)? → A: No. The maintainer,
  verbatim: "all themes should be gated." Every bundled theme is gated; there is no exemption list and no report-only
  path (FR-001–FR-003). Gothic and VI-VIM take readable text on their accent (FR-005), and #105's selection walk now
  reaches all three themes' editor selection, which their syntax colours did not clear (FR-005b).

### Round 3, 2026-11-24

- Q: Should the theme list label conforming themes "— WCAG AA"? → A: No. The maintainer, verbatim: "You don't need to
  suffix the themes with WCAG etc, we can just claim that in the documentation / release notes", and "the WCAG badge
  is ok next to the theme drop-down actually, just not in the theme name itself." The list shows bare names (FR-008);
  the mark beside the picker stays (FR-009). With every bundled theme gated, the documentation carries the claim.

### Round 4, 2026-11-24

- Q: Debian's count pill — white on its crimson, 5.18:1 — is hard to see on the dark background (the maintainer, at
  hand-testing). Change what? → A: The accent. No text on `#d70a53` does better than white, and the crimson pill
  stands only 3.36:1 off the panel. Five candidates were shown side by side; the maintainer chose "D Pink":
  `#ff5c8f` with black text, 7.18:1, the pill 5.95:1 off the background (FR-005c). The crimson stays the danger colour. The maintainer's development config already held a 39 marker
  from an earlier build of this branch, so the change ships as shipped-defaults 40 (research R4b).

## Supersession

This spec supersedes **009 FR-017**, **009 FR-018** and **019 FR-028**, and #61's "deliberately low-contrast themes stay
ungated" policy.

- **009 FR-017** made contrast build-blocking for Bash, SUBNET and Cyberpunk only. **Replaced by FR-001**: it is
  build-blocking for every bundled theme.
- **009 FR-018** reported every other theme's shortfalls as known issues that never fail the build, because those themes
  were "out of scope for redesign in this feature". **Replaced by FR-002**: no theme is reported rather than gated. The
  deferral 009 recorded under Incremental Delivery is closed by this spec.
- **019 FR-028** carved Matrix, VI-VIM and Gothic out of the syntax-colour gates as low-contrast by design. **Replaced
  by FR-001**: the syntax gates cover every bundled theme too.

**009 FR-016** (the enumerated pairing list) stands; FR-004 adds one pairing to it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every bundled theme stays legible (Priority: P1)

A maintainer changing any bundled theme cannot merge a change that leaves any measured text or control below WCAG 2.1
AA. Today only three themes are protected; the default theme and the
general-purpose themes can regress without anything noticing.

**Why this priority**: It is the guarantee everything else rests on. The picker mark (Story 3) is only honest if the
themes it marks are held to the measurement by the build.

**Independent Test**: Lower a colour in a gated theme until one of its pairings falls below its threshold and run the
theme-quality tests: they fail, naming the theme, the pairing and the measured ratio — Matrix, VI-VIM and Gothic
included.

**Acceptance Scenarios**:

1. **Given** any bundled theme, **When** any of its measured pairings falls below its WCAG 2.1 AA threshold, **Then**
   the build fails, naming the theme, the pairing and the measured ratio against the threshold.
2. **Given** the bundled themes as shipped by this feature, **When** contrast is measured, **Then** every theme passes
   every pairing.

---

### User Story 2 - Text on an accent fill is readable on every theme (Priority: P1)

A user on the VSCode theme can read the Notifications count pill (beside the Notifications title, and on the collapsed
right rail) and every other piece of text drawn on an accent fill. Today it is near-black text on a mid blue, 3.70:1 at
11px.

**Why this priority**: It is a visible defect in a shipped theme, and the same weak pair exists unnoticed in English
Garden and Debian.

**Independent Test**: Measure accent text on accent for every bundled theme; each gated theme clears 4.5:1. Open
Notifications with a pending notice under VSCode, English Garden and Debian and read the count.

**Acceptance Scenarios**:

1. **Given** any bundled theme, **When** contrast is measured, **Then** accent text on the accent fill is one of the
   measured pairings, at the body-text threshold (4.5:1).
2. **Given** VSCode, English Garden or Debian, **When** the Notifications count pill is shown, **Then** its text clears
   4.5:1 against the pill.
3. **Given** a theme whose accent-text pairing was fixed, **When** it is compared with the same theme before this
   feature, **Then** its accent colour is unchanged; only the accent text colour moved. (Debian excepted: FR-005c.)

---

### User Story 3 - Users can see which themes meet WCAG AA (Priority: P2)

A user who needs an accessible theme can tell that the selected theme meets WCAG AA contrast from a mark beside the
theme picker; the documentation says every bundled theme does. A theme of their own that falls short is not told it is
defective.

**Why this priority**: It makes the guarantee in Story 1 usable. Without it, conformance exists only in the build.

**Independent Test**: Open Preferences → Themes. The theme list shows bare names. Select a conforming theme: the mark
appears beside the picker, with a hover title. Select a theme of your own whose text matches its background: no mark, and no warning.

**Acceptance Scenarios**:

1. **Given** the Themes tab is open, **When** the user opens the theme list, **Then** every theme is listed by its
   name alone, with no conformance label (round 3).
2. **Given** the selected theme passes every measured pairing, **When** the Themes tab shows it, **Then** a mark appears
   beside the theme picker, drawn as an icon from the active icon set in theme colours, whose hover title reads
   "Meets WCAG AA contrast".
3. **Given** the selected theme fails any measured pairing, **When** the Themes tab shows it, **Then** no mark appears,
   and nothing in its place suggests a fault.
4. **Given** a user-created theme, **When** the Themes tab shows it, **Then** it is marked or unmarked by the
   same measurement as a bundled theme.
5. **Given** the user edits a colour of the selected theme, **When** the edit takes a pairing across its threshold in
   either direction, **Then** the mark follows it without reopening Preferences.

---

### Edge Cases

- **A user theme that lacks a token a pairing names**: the measurement resolves colours the way the app paints them
  (the theme's value, or the default it falls back to), so a partial theme is judged by what the user actually sees.
- **A theme file that cannot be read or parsed**: it is not marked. Its existing error reporting is unchanged.
- **A newly added bundled theme**: it is gated from the moment it ships; there is no list to leave it off.

## Requirements *(mandatory)*

### Functional Requirements

**The gate**

- **FR-001**: For every bundled theme, any measured pairing below its WCAG 2.1 AA threshold MUST fail the build, naming
  the theme, the pairing, the measured ratio and the threshold; the syntax-colour gates likewise cover every bundled
  theme. *(Supersedes 009 FR-017 and 019 FR-028.)*
- **FR-002**: No contrast shortfall in a bundled theme MAY be reported instead of failing the build. *(Supersedes 009
  FR-018.)*
- **FR-003**: No gate MAY carry a list of exempt themes. *(Round 2: replaces the single by-design list.)*

**The accent-text pairing**

- **FR-004**: Accent text on the accent fill MUST be added to the enumerated pairings at the body-text threshold
  (4.5:1). It is measured on every theme and gated by FR-001.
- **FR-004a**: The text of the three button types on their fills MUST be measured, at rest and on hover — Confirm,
  Cancel and Destroy — at 3:1, the UI-component threshold 009 FR-016 set for them; and the danger text on the danger
  colour likewise. Measured on every theme and gated by FR-001.
- **FR-005**: VSCode, English Garden, Debian, Gothic and VI-VIM MUST each have their text-on-accent colour changed, not their accent
  colour, so that accent text on accent clears 4.5:1. Every colour a theme draws on its accent fill as text (the accent
  text, the Confirm button's text at rest and on hover, the Cancel button's hover text) is that one value and moves with
  it. No other colour in those themes changes.
- **FR-005a**: SUBNET MUST have its text-on-danger colour changed, not its danger colour, so the Destroy button's text
  clears 3:1. The danger text and the Destroy button's text at rest and on hover are that one value. No other colour in
  SUBNET changes.
- **FR-005c**: Debian's accent MUST be `#ff5c8f` with black text on it, and every colour derived from the accent
  moves with it (cursors, active-panel borders, the current search match, the Confirm button, link underlines). Its
  danger colour stays `#d70a53`. *(Round 4: an exception to FR-005's "not their accent colour".)*
- **FR-005b**: Matrix, VI-VIM and Gothic MUST take the readable editor selection #105 gave the other themes — walked
  toward the editor body until every syntax colour clears 4.5:1 on it — with the inactive selection derived from it.
- **FR-006**: Every bundled theme MUST pass every pairing as shipped by this feature.

**The picker mark**

- **FR-007**: A theme MUST be presented as meeting WCAG AA if and only if it passes every pairing the build measures for
  it (the same enumerated and per-theme pairings, at the same thresholds). The conformance of a theme MUST never be
  stored, listed or hand-maintained.
- **FR-008**: The Themes tab's theme list MUST show each theme by its name alone, with no conformance label. *(Round 3:
  replaces the per-option label.)*
- **FR-009**: When the selected theme meets WCAG AA, a mark MUST appear beside the theme picker. It MUST be an icon
  drawn from the active icon set, coloured from theme tokens, with the hover title "Meets WCAG AA contrast". When the
  selected theme does not meet WCAG AA, nothing MUST be shown in its place.
- **FR-010**: Neither the list nor the picker MUST show a warning, error colour or negative mark for a theme that does
  not meet WCAG AA.
- **FR-011**: User-created themes MUST be judged exactly as bundled themes are (FR-007), using the colours the app would
  paint them with.
- **FR-012**: The mark MUST follow edits to the selected theme's colours as they are applied, without
  reopening Preferences.
- **FR-013**: The mark's icon MUST be a named icon token, so an icon set or a per-icon override can replace it like
  every other themeable icon.

**Documentation**

- **FR-014**: The user documentation for themes MUST say that every bundled theme meets WCAG AA and is held there by the
  build, and what the picker mark means.

### Key Entities

- **Contrast pairing**: a foreground colour role measured on a background colour role, with a minimum ratio. The
  enumerated set plus the per-theme extras is "every measured pairing".
- **Conformance**: a derived yes/no per theme: every measured pairing passes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 15 bundled themes are build-gated for contrast, up from 3.
- **SC-002**: Every bundled theme passes every measured pairing as shipped, including accent text on accent at 4.5:1 or
  better.
- **SC-003**: Against version 38, a theme's colours differ only in: the text-on-accent ones (FR-005) in VSCode, English
  Garden, Debian, Gothic and VI-VIM; the text-on-danger ones (FR-005a) in SUBNET; the editor selection and inactive
  selection (FR-005b) in Matrix, VI-VIM and Gothic; the accent and every colour derived from it (FR-005c) in Debian.
  Every other accent, and every danger colour, is unchanged.
- **SC-004**: In the Themes tab, the mark shows exactly when the selected theme has zero failing pairings: for each of
  the 15 bundled themes on shipping, and for any user theme by the same rule.
- **SC-005**: *(Withdrawn in round 3: the list carries no label; the documentation states that every bundled theme
  conforms.)*
- **SC-006**: Changing a selected theme's colour across a threshold updates its mark within the same interaction, with no
  reopen.

## Assumptions

- **Picker presentation** (resolved at specification, 2026-11-24; the maintainer may overrule): the Themes tab's picker
  is a native drop-down, whose options cannot hold icons. The themed icon with its hover title appears beside the
  picker for the selected theme. Round 3 dropped the text label the options first carried: every bundled theme
  conforms, so the documentation and release notes carry that claim.
- The gate's measurement is the existing one (WCAG 2.1 AA, 4.5:1 body, 3:1 large text and UI components, the 009
  enumerated list plus the later per-theme extras). No threshold changes.
- The theme switcher anywhere outside Preferences → Themes is out of scope; #61 names the Themes editor's picker.
- Keyboard and per-control accessibility stay with #26 and #442. Whole-UI contrast beyond the measured pairings stays
  with #495.
