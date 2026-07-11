# Feature Specification: Theme Content

**Feature Branch**: `009-theme-content`

**Created**: 2026-07-10

**Status**: Draft

**Input**: User description: "Theme Content — data & metadata only, no new UI. Recolour Bash to a multi-hue Git Bash palette so it is no longer a Matrix twin; replace the SUBNET and Cyberpunk placeholders with their real brand palettes; give every theme token a hand-written, abbreviation-free label and description that names the surfaces it paints; make the editor gutter themeable with its own background/foreground tokens; and add automated theme-quality guards."

## Clarifications

### Session 2026-07-10

- Q: What is the authoritative perceptual-distance metric and aggregation rule for the distinctness guard? → A: CIEDE2000, minimum token-pair distance. For each colour token present in both themes compute `d = CIEDE2000(A, B)`; the theme-pair distance is `min(d)` over shared tokens. Minimum (not mean) so one strongly-differing accent cannot rescue two otherwise-cloned palettes.
- Q: How is the distinctness threshold constant chosen, given the gate is a hard failure across all bundled themes but only three themes are redesigned? → A: Calibrate to today's real duplicates. After recolouring Bash, measure every bundled pair, find the closest legitimate pair, and set the threshold just below that distance — so Bash-vs-Matrix *before* the fix would have failed and nothing else fails. The measured closest-legitimate-pair distance is recorded so the number is auditable. No out-of-scope theme is redesigned.
- Q: Which accessibility contrast standard, ratios, and pairings are measured? → A: WCAG 2.1 AA over an explicit enumerated pairing list. 4.5:1 for body text; 3:1 for large text and UI components (accent colours count as UI components at 3:1, which is what lets SUBNET keep its neons). The list (minimum): text-on-appBackground, textMuted-on-appBackground, terminalForeground-on-terminalBackground, editorForeground-on-editorBackground, gutterForeground-on-gutterBackground, buttonText-on-buttonBackground, and the hover and active variants of the button pair. Hard failure for Bash, SUBNET and Cyberpunk only; other themes are measured and any shortfall is reported but MUST NOT fail the build.
- Q: How are abbreviations and identifier-derived descriptions detected automatically? → A: A case-insensitive, word-boundary banned-substring blocklist (at least: bg, fg, bkg, fore, min, max, cfg, config, id, num, btn, sel) so "Foreground"/"Background" pass while "App bg" fails, PLUS an assertion that no description equals the string the mechanical generator (`descriptorForThemeToken`) would produce for that token. No dictionary/word-list check (it would break on "SUBNET", "Git Bash", "throng").
- Q: What are the default gutter colours, and how is the upgrade appearance change handled? → A: A subtle offset from the editor background — `gutterBackground` slightly darker than `editorBackground` on light themes, slightly lighter on dark themes; `gutterForeground` a muted foreground that satisfies the 3:1 pairing against the new gutter background. The delta is subtle enough to read as intentional design. Every bundled theme's editor and every pre-token user theme's editor changes appearance on upgrade (user themes inherit the defaults with no migration); this is accepted and covered by tests.
- Additive request (2026-07-10): add a `dismiss` icon token to the theme icon set, default glyph `✕` (identical to `destroy` today) but a distinct token so re-skinning one never affects the other. Hand-written label/description, covered by the completeness test, inherited by every bundled theme. Nothing consumes it yet; feature 011 (main-window affordances) will. See FR-021.

### Implementation deviation (pending ratification)

- **Distinctness aggregation: mean, not minimum (OQ-1).** The clarification specified the *minimum* token-pair CIEDE2000 distance. Measured against the real bundled themes this is **degenerate**: every pair shares at least one identical colour token (pure-black backgrounds, and the shared `danger` / `success` / `unsavedDot` defaults), so the minimum is **0.00 for every pair** and cannot separate twins from distinct themes. Worse, the calibration premise ("Bash-vs-Matrix would have failed, and nothing else") is **unsatisfiable under any aggregation**, because legitimate dark themes (Windows Terminal vs VSCode, mean 4.44; VI-VIM vs Debian, median 0.63) are *closer* than the pre-fix Bash/Matrix twins (mean 5.62). Implementation therefore uses the **mean** token-pair ΔE00 (robust, catches whole-palette clones; a single differing accent cannot rescue a clone because it is averaged over ~28 tokens), with the threshold calibrated just below the closest legitimate pair (Windows Terminal vs VSCode = 4.438 → threshold 4.3). The gate still hard-fails exact/near duplicates (proven by the duplicate-theme test) and the recoloured Bash now sits ~20 ΔE00 from Matrix. Flagged in the feature report for the human to ratify.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every bundled theme looks visibly different (Priority: P1)

A user browsing the bundled theme list can tell the themes apart at a glance. In particular, the **Bash** theme reads as a colourful Git Bash prompt (green, magenta, yellow, teal, cyan) rather than a second **Matrix** — Matrix keeps its unmistakable mono-green identity, and the two are never confused. No two bundled themes are near-identical.

**Why this priority**: The defect that motivated this feature is Bash and Matrix being visually indistinguishable. A theme list where entries duplicate one another has no value; distinctness is the feature's core promise and the one automated guard that would have prevented the original twinning.

**Independent Test**: Apply Bash, then Matrix, and confirm Bash renders a multi-hue palette while Matrix stays mono-green. Run the pairwise-distinctness assertion over all bundled themes and confirm it passes and would fail if any theme were duplicated onto another.

**Acceptance Scenarios**:

1. **Given** the bundled themes, **When** the Bash theme is applied, **Then** its colour tokens span green, magenta, yellow, teal and cyan (echoing a default Git Bash prompt: green user@host, magenta shell tag, yellow path, cyan git branch) rather than a single green hue.
2. **Given** the bundled themes, **When** Bash and Matrix are compared with CIEDE2000 minimum token-pair distance, **Then** they exceed the distinctness threshold and Matrix remains mono-green.
3. **Given** the pairwise-distinctness assertion, **When** it runs over every bundled theme (including throng), **Then** no two themes are closer than the calibrated threshold and the build fails if any pair is.

---

### User Story 2 - Theme token labels and descriptions actually explain the token (Priority: P1)

A user editing a theme in the visual theme editor sees, for every colour/icon/font token, a label and description that tell them in plain, fully-spelled words what that token paints — which surfaces and elements change when they edit it — instead of a mechanical restatement of the token's identifier such as "App bg" described as "The App bg colour token."

**Why this priority**: The theme editor is only usable if the user knows what each token affects. Mechanically generated labels ("App bg", "Terminal fg") and self-referential descriptions add no information and force trial-and-error editing. This is valuable the moment the metadata is authored, with no other change required.

**Independent Test**: Read the descriptor for every theme token and confirm each label and description is hand-written, spells words in full (no abbreviation), and names concrete surfaces/elements rather than restating the identifier. The automated assertion fails if any label or description contains a banned abbreviation or equals the mechanically generated copy.

**Acceptance Scenarios**:

1. **Given** any theme token, **When** its editor descriptor is inspected, **Then** its label and description are hand-written and specific to that token.
2. **Given** any label or description, **When** it is checked against the banned-substring blocklist (case-insensitive, word-boundary), **Then** it contains no abbreviation — words are spelled in full, including "Background" and "Foreground" (never "bg"/"fg").
3. **Given** any token's description, **When** it is compared to the mechanically generated copy for that token, **Then** it is not equal to it and it names the concrete surfaces or elements the token paints.
4. **Given** the label/description assertion, **When** any token's copy violates the above, **Then** the build fails and identifies the offending token.

---

### User Story 3 - The editor gutter is themeable on its own (Priority: P2)

A user who wants the line-number gutter of the code editor to differ from the editor body can set the gutter's background and foreground independently in the theme editor, and changing them repaints only the gutter, not the editor text area.

**Why this priority**: The gutter currently borrows unrelated tokens (editor background, muted text, border), so it cannot be styled deliberately and silently changes when those tokens change. Giving it dedicated tokens is self-contained, but ranks below distinctness and legible labels.

**Independent Test**: In the theme editor, locate the gutter background and gutter foreground controls, change each, and confirm only the editor gutter repaints while the editor body is unaffected. Load a theme authored before these tokens existed and confirm it renders with the default gutter colours rather than failing.

**Acceptance Scenarios**:

1. **Given** the theme token set, **When** it is inspected, **Then** it contains distinct tokens for the editor gutter background and the editor gutter foreground, separate from the editor body tokens, the border token, and the muted-text token.
2. **Given** every bundled theme, **When** it is inspected, **Then** each supplies values for both gutter tokens.
3. **Given** the visual theme editor, **When** it is opened, **Then** both gutter tokens appear as editable colour controls with hand-written labels/descriptions, and the editor-metadata completeness test passes.
4. **Given** the editor is open, **When** a gutter token is changed, **Then** only the gutter repaints and the editor body (text, caret, selection) is unchanged.
5. **Given** a user theme saved before the gutter tokens existed, **When** it is loaded, **Then** it inherits the default gutter values and loads successfully rather than erroring.
6. **Given** the default gutter colours of any bundled theme, **When** they are measured, **Then** the gutter background is a subtle but visible offset from the editor background and the gutter foreground passes the 3:1 contrast pairing against the gutter background.

---

### User Story 4 - SUBNET uses its real brand palette (Priority: P2)

A user applying the **SUBNET** theme sees the actual SUBNET brand colours: Deep Space Blue as the primary background, with Neon Core Green and Neon Cyan reserved for accents and active states, warmth from Burnt Amber, and Gunmetal Grey chrome — not the grey placeholder approximation shipped before.

**Why this priority**: SUBNET was an explicit placeholder awaiting branding. Replacing it delivers a finished, branded theme, but it is one theme among many and does not gate the others.

**Independent Test**: Apply SUBNET and confirm Deep Space Blue is the base surface, the neons appear only as accents/active states (never as large blocks), and every colour token derives from the SUBNET brand palette.

**Acceptance Scenarios**:

1. **Given** the SUBNET theme, **When** it is applied, **Then** Deep Space Blue (#001B40) is the primary background base and dominates the large surfaces.
2. **Given** the SUBNET theme, **When** its accents and active states are inspected, **Then** they use Neon Core Green (#39FF14) and Neon Cyan (#00EFFF), and these neons are never used for large background blocks.
3. **Given** the SUBNET theme, **When** every colour token is inspected, **Then** each derives from the SUBNET palette: Neon Core Green, Neon Cyan, Deep Space Blue, Burnt Amber (#FF6F32), Gunmetal Grey (#4C4C4C), and — used sparingly — Warning Orange (#FFA500), Bright Yellow (#FFE600), and Midnight Slate (#303841) as a secondary dark background where Deep Space Blue is too intense.
4. **Given** the SUBNET theme, **When** its enumerated foreground-on-background pairings are measured against WCAG 2.1 AA, **Then** they pass (body text 4.5:1; large text and UI/accent components 3:1).

---

### User Story 5 - Cyberpunk uses its real reference palette (Priority: P3)

A user applying the **Cyberpunk** theme sees a near-black base with crimson and deep-maroon structure, bright-yellow highlights, and pale-teal accents drawn from the reference palette, rather than the previous placeholder.

**Why this priority**: Like SUBNET, Cyberpunk is a placeholder being finished. It is lower priority because it is a single theme with a smaller, well-defined palette and no branding subtleties to reserve.

**Independent Test**: Apply Cyberpunk and confirm every colour token derives from the reference palette (#000000, #c5003c, #880425, #f3e600, #55ead4), with the near-black as base.

**Acceptance Scenarios**:

1. **Given** the Cyberpunk theme, **When** it is applied, **Then** the near-black (#000000) is the base surface and crimson (#c5003c) / deep maroon (#880425) provide structure.
2. **Given** the Cyberpunk theme, **When** highlights and accents are inspected, **Then** bright yellow (#f3e600) and pale teal (#55ead4) are used for highlights/accents.
3. **Given** the Cyberpunk theme, **When** every colour token is inspected, **Then** each derives from the reference palette.
4. **Given** the Cyberpunk theme, **When** its enumerated foreground-on-background pairings are measured against WCAG 2.1 AA, **Then** they pass.

---

### User Story 6 - Theme quality is guarded automatically (Priority: P2)

A maintainer adding or editing a bundled theme is protected by automated guards: two bundled themes can never again become perceptual twins, and contrast is measured for every theme so accessibility regressions in the in-scope themes cannot be merged, while known shortfalls in out-of-scope themes are reported without blocking.

**Why this priority**: These guards make the other stories durable — they turn "Bash and Matrix must differ" and "the in-scope themes must be legible" into build-enforced invariants. They rank below the content fixes because they protect that work rather than deliver it.

**Independent Test**: Run the theme-quality suite. Confirm the distinctness assertion fails the build for any too-close pair across all bundled themes; confirm contrast is measured for every theme; confirm Bash, SUBNET and Cyberpunk failing contrast fails the build while contrast shortfalls in other themes are reported as known issues and do not fail the build.

**Acceptance Scenarios**:

1. **Given** all bundled themes, **When** the distinctness assertion runs (CIEDE2000, minimum token-pair distance), **Then** any pair closer than the calibrated threshold fails the build (hard failure, no exemptions).
2. **Given** all bundled themes, **When** contrast is measured, **Then** every theme's enumerated foreground-on-background pairings are evaluated against WCAG 2.1 AA.
3. **Given** the in-scope themes (Bash, SUBNET, Cyberpunk), **When** any of their measured pairings falls below the standard, **Then** the build fails.
4. **Given** the out-of-scope bundled themes, **When** any of their measured pairings falls below the standard, **Then** the shortfall is reported as a known issue and the build does not fail.

---

### Edge Cases

- **User theme missing gutter tokens**: A theme file authored before the gutter tokens existed MUST load and inherit the default gutter values (no load failure, no migration), consistent with how missing tokens already fall back to the built-in defaults. Its editor gutter appearance changes to the new default; this is accepted.
- **Bundled theme accidentally duplicated**: If a future edit makes two bundled themes near-identical, the pairwise-distinctness guard MUST fail the build and name the offending pair.
- **New token added without copy**: If a theme token is added without a hand-written label/description, the copy assertion MUST fail and name the token (it would otherwise fall back to mechanically generated copy, which the assertion also rejects).
- **Abbreviation slips into copy**: If any label/description matches a banned substring on a word boundary (for example "bg", "fg", "min", "config"), or equals the mechanically generated copy, the copy assertion MUST fail.
- **Distinctness vs. redesign scope conflict (resolved)**: The threshold is calibrated to sit just below the closest legitimate bundled pair after recolouring, so no out-of-scope theme trips the gate and none is redesigned.
- **Neon overuse in SUBNET**: The SUBNET neons must be confined to accents/active states; using a neon as a large background block MUST be avoided (checked implicitly by the base-surface requirement plus contrast at the 3:1 UI threshold).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The **Bash** theme MUST be recoloured to a multi-hue palette spanning green, magenta, yellow, teal and cyan, echoing a default Git Bash prompt, and MUST be visually distinguishable from the **Matrix** theme.
- **FR-002**: The **Matrix** theme MUST retain its mono-green-on-black identity (unchanged in character).
- **FR-003**: The **SUBNET** theme MUST derive every colour token from the SUBNET brand palette (Neon Core Green #39FF14, Neon Cyan #00EFFF, Deep Space Blue #001B40, Burnt Amber #FF6F32, Gunmetal Grey #4C4C4C, and — sparingly — Warning Orange #FFA500, Bright Yellow #FFE600, Midnight Slate #303841).
- **FR-004**: In **SUBNET**, Deep Space Blue MUST be the primary background/base surface, and the neons (Neon Core Green, Neon Cyan) MUST be reserved for accents and active states and MUST NOT be used for large background blocks.
- **FR-005**: The **Cyberpunk** theme MUST derive its colour tokens from the reference palette (#000000, #c5003c, #880425, #f3e600, #55ead4), with the near-black as base.
- **FR-006**: Every theme token (colour, icon, and font/typography) MUST carry a **hand-written** label and description in the editor-metadata registry, replacing the mechanically generated copy for those tokens.
- **FR-007**: Every token label and description MUST spell words in full — "Background" and "Foreground", never "bg"/"fg" — and MUST contain no abbreviation from the banned-substring blocklist.
- **FR-008**: Every token description MUST name the concrete surfaces or elements that the token paints and MUST NOT merely restate the token's own name/identifier.
- **FR-009**: An automated assertion MUST fail if any token label or description matches a banned abbreviation substring (case-insensitive, word-boundary; blocklist at least: bg, fg, bkg, fore, min, max, cfg, config, id, num, btn, sel), or if any description equals the string the mechanical generator (`descriptorForThemeToken`) would produce for that token. The assertion MUST NOT use a dictionary/word-list check.
- **FR-010**: The theme token set MUST gain **distinct tokens for the editor gutter background and the editor gutter foreground**, separate from the editor body, border, and muted-text tokens.
- **FR-011**: The editor gutter MUST render from the new gutter tokens; changing a gutter token MUST affect only the gutter and MUST NOT change the editor body (text area, caret, selection).
- **FR-012**: Every bundled theme MUST supply values for both new gutter tokens. The default gutter background MUST be a subtle offset from that theme's editor background (darker on light themes, lighter on dark themes), and the default gutter foreground MUST be a muted foreground that satisfies the 3:1 contrast pairing against the gutter background.
- **FR-013**: The new gutter tokens MUST be exposed in the visual theme editor as editable controls with hand-written labels/descriptions and MUST be covered by the editor-metadata completeness test — satisfying the constitution's configuration-editor-completeness rule with no change to theme-editor rendering code.
- **FR-014**: A user theme that predates the gutter tokens MUST inherit the default gutter values and load successfully without a migration, rather than failing to load.
- **FR-015**: An automated **distinctness** assertion MUST compute, for each bundled theme pair, the minimum CIEDE2000 distance across the colour tokens present in both themes, and MUST fail the build for any pair whose minimum is below the calibrated threshold (hard failure across all bundled themes, no exemptions).
- **FR-016**: Contrast MUST be measured for an explicit enumerated list of foreground-on-background pairings of **every** bundled theme against WCAG 2.1 AA (4.5:1 body text; 3:1 large text and UI/accent components). The list MUST include at least: text-on-appBackground, textMuted-on-appBackground, terminalForeground-on-terminalBackground, editorForeground-on-editorBackground, gutterForeground-on-gutterBackground, buttonText-on-buttonBackground, and the hover and active variants of the button pair.
- **FR-017**: For **Bash, SUBNET and Cyberpunk**, any measured pairing below its WCAG 2.1 AA threshold MUST fail the build.
- **FR-018**: For all **other** bundled themes, contrast shortfalls MUST be reported as known issues and MUST NOT fail the build (those themes are out of scope for redesign in this feature).
- **FR-019**: The distinctness threshold and the contrast standard MUST each be a single named constant defined in one authoritative place. The distinctness threshold MUST be calibrated to sit just below the closest legitimate bundled pair (measured after recolouring Bash), and the measured closest-legitimate-pair distance MUST be recorded so the chosen number is auditable. The contrast standard is WCAG 2.1 AA (4.5:1 / 3:1).
- **FR-020**: This feature MUST ship no new UI surface and MUST NOT require changes to the theme-editor rendering code or to files owned by sibling features (preferences renderer, icon-pack service, main process, config store); it changes theme data and editor metadata only.
- **FR-021**: The theme icon set MUST gain a `dismiss` icon token whose default glyph is `✕` (the same glyph `destroy` uses), distinct from `destroy` so re-skinning one never changes the other. It MUST carry a hand-written label and description (naming the dismiss-a-transient-message action, distinct from destroying a thing), be inherited by every bundled theme, and be covered by the editor-metadata completeness test. Nothing consumes it in this feature; feature 011 does.

### Key Entities

- **Theme**: A named document of colour tokens, fonts/typography, and icons. This feature edits the colour tokens of the Bash, SUBNET, and Cyberpunk bundled themes, and adds two colour tokens (gutter background, gutter foreground) present in every theme.
- **Theme colour token**: A single named colour within a theme (for example the editor gutter background). Gains two new members for the gutter; all members gain hand-written editor copy.
- **Editor-metadata descriptor**: The registry entry that tells the visual editor how to render and describe one theme token (label, description, group, control). This feature replaces mechanically generated labels/descriptions with hand-written ones and adds descriptors for the two gutter tokens (derived automatically from the token set).
- **Theme-quality constants**: The named distinctness threshold (calibrated CIEDE2000 minimum) and the contrast standard (WCAG 2.1 AA) used by the automated guards, defined once.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Bash and Matrix are measurably distinct — their minimum CIEDE2000 token-pair distance exceeds the calibrated threshold — and a reviewer shown both without labels can tell which is which.
- **SC-002**: The Bash palette visibly uses at least the five named hues (green, magenta, yellow, teal, cyan).
- **SC-003**: 100% of theme tokens have a hand-written label and description; 0% use the mechanically generated fallback copy.
- **SC-004**: 0 token labels/descriptions match a banned abbreviation substring, and 0 descriptions equal their mechanically generated copy (asserted automatically).
- **SC-005**: The theme token set contains exactly two new gutter tokens (background and foreground); every bundled theme supplies both; the editor-metadata completeness test passes with them exposed.
- **SC-006**: Changing a gutter token in the editor changes only the gutter (the editor body's computed styles are unchanged).
- **SC-007**: Every SUBNET colour token maps to a SUBNET-palette colour, with Deep Space Blue as the base surface and neons only on accents/active states; its enumerated pairings pass WCAG 2.1 AA.
- **SC-008**: Every Cyberpunk colour token maps to a colour in the reference palette; its enumerated pairings pass WCAG 2.1 AA.
- **SC-009**: The pairwise-distinctness assertion passes for all bundled themes and demonstrably fails when any theme is duplicated onto another.
- **SC-010**: Contrast is measured for every bundled theme; Bash, SUBNET and Cyberpunk pass WCAG 2.1 AA (build-blocking), and any shortfall in other themes is reported as a known issue without failing the build.
- **SC-011**: A user theme file saved before this feature (no gutter tokens) loads without error and renders the default gutter colours.

## Assumptions

- **No new UI**: The visual theme editor already renders every token generically from the derived editor-metadata registry (grouping by section, one control per token by inferred control type). Adding the two gutter colour tokens to the theme structure therefore surfaces them as colour controls automatically; no theme-editor rendering code changes. This has been verified against the current renderer.
- **Fallback already exists**: Colour tokens already fall back to the built-in default theme when absent, so pre-gutter user themes inherit default gutter values without a migration. No schema/version migration is introduced.
- **Gutter token naming**: The two new tokens are editor-scoped colour tokens (working names such as "editor gutter background" / "editor gutter foreground") that live in the same colour token set as the existing editor tokens, so they are covered by the completeness and per-theme tests. They are general theme colour tokens, not editor-panel-private, and appear in the theme editor like any other colour token.
- **Gutter default appearance change is accepted**: The default gutter background is a subtle offset from the editor background, so every bundled theme's editor and every pre-token user theme's editor changes appearance on upgrade. The delta is chosen subtle enough to read as intentional design, and this is a documented, user-facing change.
- **Brand palettes are approximations**: Bundled brand-derived themes remain best-effort colour approximations, not official brand assets. SUBNET and Cyberpunk cease to be placeholders once their tokens derive from the specified palettes.
- **In-scope redesign set**: Only Bash, SUBNET and Cyberpunk are redesigned/required to pass contrast in this feature. Other bundled themes are not re-tuned here; their contrast shortfalls are recorded as known issues (a tracked deferral under the Incremental Delivery rule).
- **Metric and standard**: The distinctness metric is CIEDE2000 (minimum token-pair distance) and the contrast standard is WCAG 2.1 AA (4.5:1 / 3:1); the distinctness threshold is calibrated to the closest legitimate bundled pair and recorded for audit.
- **Files owned**: This feature owns the theme model, theme editor-metadata, bundled default themes, the editor stylesheet, and its own tests. It does not touch the preferences renderer, icon-pack service, main process, or config store (sibling features own those). Icon packs, including any renaming of the throng-svg pack, are out of scope.
